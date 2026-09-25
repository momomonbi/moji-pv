#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Contact sheet: a labelled PNG grid of parts at several normalized times (lab page).

    python3 tests/browser/contact_sheet.py --kind arrive [--keys inkRise,hingeFlip] [--aspect 16:9]
        [--times 0.1,0.3,0.6,0.9] [--text はじまりの朝] [--theme sumiWashi] [--orient h|v] [--parts catalog|examples|stub]
        [--backdrop scene] [--cell 320] [--fonts] [--params '{"amount":0.55,"when":"impact"}'] [--impact]
        [--impulses flash@0.6,shake@1.2:0.8] --out /tmp/sheet.png
    python3 tests/browser/contact_sheet.py --list          # the parts each registry has
    python3 tests/browser/contact_sheet.py                 # self-check (CI): one small sheet per kind, nothing written

One row per part, one column per time. A time u (0..1) is normalized over the part's own window: arrive → its entrance,
depart → its exit, dwell → the hold between them, seam → the transition, every other kind → the whole visible cut.
Each cell is the canned sample cut of engine/facade.samplePlan (the part in its slot, fallback parts elsewhere).
--params sets the part's params (JSON; the rest stay auto). --impact makes the sample cut an impact (「!」) cut with the
impulses the planner gives one (flash, shake, slip at its sung start; amounts from the mood, at least 0.6 / 0.5 / 0.3 so
the sheet shows them). --impulses adds impulses kind@seconds[:amp] (flash shake slip punch) to the sample plan.
The time label sits in a strip under each cell, so nothing of the frame is covered (a composition in the bottom-left
corner, cornerNote or creditFold, stays visible).
Parts come from parts/catalog when it exists, else from the test fixtures (tests/fixtures/example_parts.js and
stub_parts.js). Google Fonts are blocked unless --fonts is given, so the sheet is fast and uses fallback faces.
Open the PNG with any image viewer (or the Read tool). Exit status 1 when a cell failed to render.
Without --kind (CI runs every browser test with its default arguments) it checks itself instead: for every kind of the
default registry, a sheet of two of that kind's parts at two times, kept in memory; it fails when a
cell fails, the page reports an error or a CSP violation, or a sheet comes back empty.

This file also holds the lab-page helpers the other engine browser tests import (parts_gallery.py, glyph_parity.py,
determinism.py, perf.py): lab_html() assembles the lab page in memory from the current sources the way build.py does
(kernel, modules in topological order, MV.DEV = true, boot 'ui/lab', the build's CSP), with the fixtures in front;
open_lab() serves it to a Playwright page through a route, so nothing is written to disk. japanese_font_missing (from
dev/browser.py) is passed on with them.
Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/contact_sheet.py …   (CI: PW_CHANNEL=chrome)
"""
import argparse
import asyncio
import base64
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
from browser import launch, new_page, japanese_font_missing  # noqa: E402,F401  (dev/browser.py, the shared launcher)

FIXTURES = ROOT / 'tests' / 'fixtures'
PROJECTS = ('basic', 'vertical', 'lrc', 'long')
FONT_HOSTS = ('https://fonts.googleapis.com/**', 'https://fonts.gstatic.com/**')
LAB_URL = 'http://mv-lab.test/lab.html'
RECORD_VIOLATIONS = """
window.__cspViolations = [];
document.addEventListener('securitypolicyviolation', (e) => {
  window.__cspViolations.push(e.violatedDirective + ' ' + (e.blockedURI || '') + ' ' + (e.sourceFile || '') + ':' + e.lineNumber);
});
"""
LAB_READY = "() => typeof window.__lab === 'object' && !!window.__lab"


def load_build():
    spec = importlib.util.spec_from_file_location('mv_build', ROOT / 'build.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def commonjs(name, path):
    """A CommonJS fixture as a browser script: its module.exports lands in globalThis.MVLabFixtures[name]."""
    text = path.read_text(encoding='utf-8')
    return ('(function () {\n  const module = { exports: {} };\n'
            "  const require = () => { throw new Error('require() is not available in the lab page'); };\n"
            + text + '\n  (globalThis.MVLabFixtures || (globalThis.MVLabFixtures = {}))[' + json.dumps(name)
            + '] = module.exports;\n})();\n')


def fixtures_script():
    projects = {}
    for name in PROJECTS:
        projects[name] = json.loads((FIXTURES / ('project_%s.json' % name)).read_text(encoding='utf-8'))['doc']
    return (commonjs('stub', FIXTURES / 'stub_parts.js') + commonjs('examples', FIXTURES / 'example_parts.js')
            + '(globalThis.MVLabFixtures || (globalThis.MVLabFixtures = {})).projects = '
            + json.dumps(projects, ensure_ascii=False) + ';\n')


def lab_html(quiet=False):
    """The lab page from the current sources (lint problems are reported, not fatal: a part in progress still shows)."""
    build = load_build()
    problems = build.Problems(ROOT)
    kernel, modules, _css = build.collect(ROOT, problems)
    build.check_layers(modules, problems)
    for mod in modules.values():
        build.lint(mod, problems)
    order = build.topo_sort(modules, problems)
    if problems and not quiet:
        problems.report(sys.stderr)
        print('contact_sheet: %d build problem(s) above; rendering anyway' % len(problems.items), file=sys.stderr)
    if 'ui/lab' not in modules:
        raise SystemExit('contact_sheet: src/ui/lab.js is missing')
    app = build.app_script(kernel, modules, order, 'ja', True, 'ui/lab')
    return build.render_page('ja', 'lab', '', [fixtures_script()], app)


async def open_lab(browser, fonts=False, html=None, viewport=None):
    """A Playwright page with the lab loaded: fonts blocked unless asked for, page errors and CSP violations recorded
    (page.lab_errors, window.__cspViolations)."""
    page = await new_page(browser, viewport=viewport or {'width': 1280, 'height': 900})
    body = html or lab_html(quiet=True)
    page.lab_errors = []
    page.on('pageerror', lambda e: page.lab_errors.append(str(e)))
    blocked = 'net::ERR_FAILED'                  # the font requests this page aborts on purpose

    def console(m):
        if m.type == 'error' and (fonts or blocked not in m.text):
            page.lab_errors.append(m.text)
    page.on('console', console)

    async def serve(route):
        await route.fulfill(status=200, content_type='text/html; charset=utf-8', body=body)

    await page.route(LAB_URL, serve)
    if not fonts:
        for host in FONT_HOSTS:
            await page.route(host, lambda route: route.abort())
    await page.add_init_script(RECORD_VIOLATIONS)
    await page.goto(LAB_URL, wait_until='load')
    await page.wait_for_function(LAB_READY, timeout=15000)
    return page


async def csp_violations(page):
    return await page.evaluate('window.__cspViolations')


# The sheet, built in the lab page from the engine modules (the lab's own sheet draws its time label over the cell's
# bottom-left corner and has no params, impact or impulses). o = the options of run() below.
SHEET_JS = r"""async (o) => {
  const FAC = MV.use('engine/facade'), HC = MV.use('engine/host/canvas'), HM = MV.use('engine/host/measure');
  const HF = MV.use('engine/host/fonts'), DOC = MV.use('core/doc'), REG = MV.use('core/registry'), K = MV.use('parts/kit');
  const fx = globalThis.MVLabFixtures || {};
  const registryOf = (source) => {
    if (source === 'catalog') return MV.use('parts/catalog').defaultRegistry();
    if (source === 'stub') return REG.createRegistry(fx.stub.allStubParts());
    const fallbacks = fx.stub.fallbackParts().filter((d) => d.kind !== 'theme' && d.kind !== 'mood');
    return REG.createRegistry(fx.examples.exampleParts(K).concat(fallbacks));
  };
  const reg = registryOf(o.parts);
  const keys = (o.keys && o.keys.length ? o.keys : reg.keys(o.kind)).filter((k) => !!k);
  const times = o.times && o.times.length ? o.times : [0.1, 0.3, 0.6, 0.9];
  const aspect = DOC.DESIGN_SIZE[o.aspect] ? o.aspect : '16:9';
  const [dw, dh] = DOC.DESIGN_SIZE[aspect];
  const cellW = Math.max(80, Math.min(640, o.cell || (dw >= dh ? 320 : 200))), cellH = Math.round((cellW * dh) / dw);
  const labelW = 200, headH = 54, gap = 6, capH = 16;
  const W = labelW + times.length * (cellW + gap) + gap, H = headH + keys.length * (cellH + capH + gap) + gap;
  const factory = HC.createCanvasFactory();
  const fonts = o.fonts ? HF.createFontBook({ document, timeoutMs: 8000 }) : null;
  const engine = FAC.createEngine({ registry: reg, canvas: factory, measurer: HM.createCanvasMeasurer(factory, fonts), fonts,
    assets: null });
  const sheet = document.createElement('canvas');
  sheet.width = W; sheet.height = H;
  const g = sheet.getContext('2d');
  g.fillStyle = '#1b1d22'; g.fillRect(0, 0, W, H);
  g.textBaseline = 'top';
  g.fillStyle = '#e8e8e8'; g.font = '600 15px system-ui, sans-serif';
  const extras = (o.params ? ' · params ' + JSON.stringify(o.params) : '') + (o.impact ? ' · impact' : '')
    + (o.impulses.length ? ' · impulses ' + o.impulses.map((x) => x.kind + '@' + x.t).join(',') : '');
  g.fillText(o.kind + ' · ' + aspect + ' · theme ' + (o.theme || reg.fallback('theme')) + ' · parts ' + o.parts + ' · "'
    + (o.text || FAC.SAMPLE_TEXT) + '"' + extras, gap, 8);
  g.font = '12px system-ui, sans-serif'; g.fillStyle = '#aaa';
  times.forEach((u, c) => g.fillText('u = ' + Number(u).toFixed(2), labelW + c * (cellW + gap) + 4, 34));
  const made = factory.create(cellW, cellH, { alpha: o.backdrop !== 'clear' });
  const cell = { canvas: made.canvas, ctx: made.ctx, w: cellW, h: cellH };
  const DECAY = { flash: 0.18, shake: 0.4, slip: 0.25, punch: 0.35 };
  // [t0, t1] of the part's own window (as the lab's sheet: entrance, exit, hold, transition, else the whole cut)
  const windowOf = (plan) => {
    const cut = plan.cuts[0], scene = engine.scene('cut', 0);
    const tm = scene ? scene.times : { a: cut.a - cut.t0, rest: 0, out: cut.t1 - cut.t0, b: cut.b - cut.t0 };
    const end = cut.b - 0.001, clampT = (x) => Math.min(end, Math.max(cut.a, x));
    if (o.kind === 'arrive') return [clampT(cut.t0 + tm.a), clampT(cut.t0 + Math.max(tm.rest, tm.a + 0.01))];
    if (o.kind === 'depart') return [clampT(cut.t0 + Math.min(tm.out, tm.b - 0.01)), end];
    if (o.kind === 'dwell') return [clampT(cut.t0 + tm.rest), clampT(cut.t0 + Math.max(tm.out, tm.rest + 0.01))];
    if (o.kind === 'seam' && plan.seams.length) { const sm = plan.seams[0]; return [sm.at - sm.dur / 2, sm.at + sm.dur / 2 - 0.001]; }
    return [cut.a, end];
  };
  const errors = [], means = [];
  let cells = 0, covered = 0;
  // mean luminance of a surface (for the self-check's impact comparison)
  const meanOf = (ctx, x, y, w, h) => {
    const d = ctx.getImageData(x, y, w, h).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4) / 255;
  };
  for (let r = 0; r < keys.length; r++) {
    means.push([]);
    const key = keys[r], def = reg.get(o.kind, key), y = headH + r * (cellH + capH + gap);
    g.fillStyle = '#e8e8e8'; g.font = '600 13px system-ui, sans-serif';
    g.fillText(key, gap, y + 4);
    g.font = '12px system-ui, sans-serif'; g.fillStyle = '#aaa';
    if (def) g.fillText(def.label.ja + ' / ' + def.label.en, gap, y + 22);
    let plan = null;
    try {
      if (!def) throw new Error('unknown part');
      plan = FAC.samplePlan(reg, { kind: o.kind, key, params: o.params || undefined },
        { text: o.text || undefined, theme: o.theme || undefined, aspect, orient: o.orient || undefined, backdrop: o.backdrop });
      const a = plan.look.amounts || {};
      if (o.impact) {
        for (const c of plan.cuts) {
          c.impact = true; c.feat = Object.assign({}, c.feat, { impact: true }); c.fp += ':impact';
          plan.impulses.push({ amp: Math.max(a.flash || 0, 0.6), decay: DECAY.flash, kind: 'flash', t: c.t0 },
            { amp: Math.max(a.shake || 0, 0.5), decay: DECAY.shake, kind: 'shake', t: c.t0 },
            { amp: Math.max(a.glitch || 0, 0.3), decay: DECAY.slip, kind: 'slip', t: c.t0 });
        }
      }
      for (const x of o.impulses) plan.impulses.push({ amp: x.amp, decay: DECAY[x.kind], kind: x.kind, t: x.t });
      plan.impulses.sort((p, q) => p.t - q.t);
      engine.setPlan(plan);
      if (o.fonts) await engine.prepare(0, plan.duration, { export: true });
    } catch (e) {
      errors.push(o.kind + '/' + key + ': ' + (e && e.message));
      plan = null;
    }
    for (let c = 0; c < times.length; c++) {
      const x = labelW + c * (cellW + gap);
      try {
        if (!plan) throw new Error('no sample plan');
        const [t0, t1] = windowOf(plan), t = t0 + (t1 - t0) * Math.min(1, Math.max(0, times[c]));
        engine.renderFrame(cell, t, { quality: 'export', pick: false, scale: Math.min(cellW / plan.design.w, cellH / plan.design.h),
          backdrop: o.backdrop });
        g.drawImage(cell.canvas, x, y);
        g.fillStyle = '#aaa'; g.font = '11px system-ui, sans-serif';
        g.fillText('t=' + t.toFixed(2) + 's', x + 3, y + cellH + 2);
        means[r].push(meanOf(cell.ctx, 0, 0, cellW, cellH));
        // the bottom-left corner of the frame must be on the sheet as rendered (no label over it)
        if (o.backdrop !== 'clear') {
          const cw = Math.min(90, cellW), ch = Math.min(24, cellH);
          const a = g.getImageData(x, y + cellH - ch, cw, ch).data, b = cell.ctx.getImageData(0, cellH - ch, cw, ch).data;
          for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 2) { covered++; break; }
        }
        cells++;
      } catch (e) {
        errors.push(o.kind + '/' + key + ' u=' + times[c] + ': ' + (e && e.message));
        g.fillStyle = '#5a1d1d'; g.fillRect(x, y, cellW, cellH);
        g.fillStyle = '#ffb4b4'; g.font = '12px system-ui, sans-serif';
        g.fillText(String(e && e.message).slice(0, 60), x + 6, y + 6);
      }
    }
  }
  for (const e of engine.warnings()) if (e.code === 'part-error') errors.push(e.detail);
  engine.dispose();
  return { png: sheet.toDataURL('image/png'), cells, errors, width: W, height: H, means, covered };
}"""


IMPULSE_KINDS = ('flash', 'shake', 'slip', 'punch')


def parse_impulses(text):
    """'flash@0.6,shake@1.2:0.8' → [{kind, t, amp}] (amp 1 when not given)."""
    out = []
    for item in parse_list(text):
        kind, _, rest = item.partition('@')
        at, _, amp = rest.partition(':')
        if kind not in IMPULSE_KINDS or not at:
            raise SystemExit('contact_sheet: bad impulse %r (kind@seconds[:amp], kinds %s)' % (item, ' '.join(IMPULSE_KINDS)))
        out.append({'kind': kind, 't': float(at), 'amp': float(amp) if amp else 1.0})
    return out


async def render_sheet(page, opts):
    return await page.evaluate(SHEET_JS, opts)


def parse_list(text, cast=str):
    return [cast(x.strip()) for x in text.split(',') if x.strip()] if text else []


async def run(args):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await launch(p)
        try:
            page = await open_lab(browser, fonts=args.fonts, html=lab_html(quiet=args.list))
            info = await page.evaluate('window.__lab.info()')
            if args.list:
                for src in info['sources']:
                    print('[%s]' % src)
                    for kind, keys in info['parts'][src].items():
                        print('  %-9s %s' % (kind, ' '.join(keys)))
                return 0
            if not info['sources']:
                print('contact_sheet: no parts (no parts/catalog and no fixtures)', file=sys.stderr)
                return 1
            if not args.kind:
                return await self_check(page, info)
            opts = {'kind': args.kind, 'keys': parse_list(args.keys), 'aspect': args.aspect,
                    'times': parse_list(args.times, float), 'text': args.text or None, 'theme': args.theme or None,
                    'orient': args.orient or None, 'parts': args.parts or info['sources'][0], 'backdrop': args.backdrop,
                    'cell': args.cell, 'fonts': bool(args.fonts), 'params': json.loads(args.params) if args.params else None,
                    'impact': bool(args.impact), 'impulses': parse_impulses(args.impulses)}
            result = await render_sheet(page, opts)
            data = base64.b64decode(result['png'].split(',', 1)[1])
            out = Path(args.out)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
            print('contact_sheet: wrote %s (%dx%d, %d cells)' % (out, result['width'], result['height'], result['cells']))
            problems = result['errors'] + page.lab_errors + await csp_violations(page)
            for msg in problems:
                print('  ' + msg)
            return 1 if problems else 0
        finally:
            await browser.close()


async def self_check(page, info):
    """One small sheet per kind of the default registry (two parts, two times), in memory: the tool itself still works."""
    source = info['sources'][0]
    failures, sheets = [], 0
    for kind, keys in info['parts'][source].items():
        if not keys:
            continue
        pick = keys[:1] + keys[len(keys) // 2:len(keys) // 2 + 1] if len(keys) > 1 else keys
        opts = {'kind': kind, 'keys': pick, 'aspect': '16:9', 'times': [0.3, 0.7], 'text': None, 'theme': None,
                'orient': None, 'parts': source, 'backdrop': 'scene', 'cell': 160, 'fonts': False, 'params': None,
                'impact': False, 'impulses': []}
        result = await render_sheet(page, opts)
        sheets += 1
        if result['cells'] != len(pick) * 2 or not result['png'].startswith('data:image/png'):
            failures.append('%s: %d cells for %d parts × 2 times' % (kind, result['cells'], len(pick)))
        if result['covered']:
            failures.append('%s: %d cells have something drawn over their bottom-left corner' % (kind, result['covered']))
        failures.extend('%s: %s' % (kind, msg) for msg in result['errors'])
    failures.extend(await check_options(page, info, source))
    failures.extend(page.lab_errors + await csp_violations(page))
    for msg in failures:
        print('FAIL ' + msg)
    print('contact_sheet: self-check %s (%s: %d kinds, nothing written)' % ('FAILED' if failures else 'OK', source, sheets))
    return 1 if failures else 0


async def check_options(page, info, source):
    """--params, --impact and --impulses reach the frame: a flash effect set to fire on impacts shows on an impact cut and
    not on a plain one; a flash impulse brightens a cut whose effect follows impulses."""
    if 'flashPop' not in info['parts'][source].get('filter', []):
        return []
    dark = 'nightTram' if 'nightTram' in info['parts'][source].get('theme', []) else None
    base = {'kind': 'filter', 'keys': ['flashPop'], 'aspect': '16:9', 'times': [0.05, 0.9], 'text': None, 'theme': dark,
            'orient': None, 'parts': source, 'backdrop': 'scene', 'cell': 160, 'fonts': False,
            'params': {'amount': 0.9, 'when': 'impact'}, 'impact': False, 'impulses': []}
    plain = await render_sheet(page, base)
    hit = await render_sheet(page, dict(base, impact=True))
    out = ['options: %s' % m for m in plain['errors'] + hit['errors']]
    lift = hit['means'][0][0] - plain['means'][0][0]
    print('%s contact_sheet --impact: flashPop (when impact) brightens the impact cut by %.3f (plain %.3f)' % (
        'ok  ' if lift > 0.05 else 'FAIL', lift, plain['means'][0][0]))
    if not lift > 0.05:
        out.append('--impact / --params did not reach the frame (flashPop lift %.3f)' % lift)
    late = abs(hit['means'][0][1] - plain['means'][0][1])
    if late > 0.02:
        out.append('the impact flash is still on at the end of the cut (%.3f)' % late)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description='Render a contact sheet of parts through the lab page.')
    ap.add_argument('--kind', help='part kind: arrange arrive dwell depart ground ornament lens filter seam theme mood '
                    '(without it: the self-check)')
    ap.add_argument('--keys', default='', help='comma-separated part keys (default: every part of the kind)')
    ap.add_argument('--aspect', default='16:9')
    ap.add_argument('--times', default='0.1,0.3,0.6,0.9', help='normalized times, comma-separated')
    ap.add_argument('--text', default='', help='the sample line (default: はじまりの朝)')
    ap.add_argument('--theme', default='', help='theme key (default: the fallback theme)')
    ap.add_argument('--orient', default='', choices=['', 'h', 'v'])
    ap.add_argument('--parts', default='', help='registry: catalog | examples | stub (default: catalog, else examples)')
    ap.add_argument('--backdrop', default='scene', choices=['scene', 'chroma', 'black', 'clear'])
    ap.add_argument('--cell', type=int, default=0, help='cell width in px (default 320, 200 for tall aspects)')
    ap.add_argument('--fonts', action='store_true', help='load the real Google Fonts faces (slower; needs the network)')
    ap.add_argument('--params', default='', help='the part\'s params as JSON, e.g. \'{"amount":0.55,"when":"impact"}\'')
    ap.add_argument('--impact', action='store_true', help='make the sample cut an impact cut, with its impulses')
    ap.add_argument('--impulses', default='', help='extra impulses kind@seconds[:amp], comma-separated (flash shake slip punch)')
    ap.add_argument('--list', action='store_true', help='list the parts and exit')
    ap.add_argument('--out', default='/tmp/sheet.png')
    args = ap.parse_args(argv)
    return asyncio.run(run(args))


if __name__ == '__main__':
    sys.exit(main())
