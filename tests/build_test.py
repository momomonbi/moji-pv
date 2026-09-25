#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Tests for build.py (DESIGN §2.3–§2.6, §8.2 build_test.py).

Builds copies of the tree under a temporary directory (build.py --root), so the working tree is never touched:
identical bytes on rebuild, CSP hashes that match the inline blocks, and seeded lint / layer violations failing --check.
Run: python3 tests/build_test.py
"""
import base64
import hashlib
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BUILD = REPO / 'build.py'
HEADER = '/* 文字PVメーカー v2 — original work. Test module. */\n'
CSP_TAIL = ("https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src "
            "https://generativelanguage.googleapis.com https://api.anthropic.com; img-src data: blob:; media-src blob:; "
            "worker-src 'none'; base-uri 'none'; form-action 'none'")


def run_build(root, *args):
    proc = subprocess.run([sys.executable, str(BUILD), '--root', str(root), *args], capture_output=True, text=True)
    return proc.returncode, proc.stdout + proc.stderr


def sha(text):
    return "'sha256-" + base64.b64encode(hashlib.sha256(text.encode('utf-8')).digest()).decode('ascii') + "'"


def as_parsed(raw):
    """An inline element's text as the browser hashes it for the CSP check: the HTML parser turns CRLF and a lone
    CR into LF, and a NUL into U+FFFD, before any script or style text exists."""
    return raw.replace('\r\n', '\n').replace('\r', '\n').replace('\x00', '\ufffd')


def expected_csp(scripts, styles):
    return ("default-src 'none'; script-src " + ' '.join(sha(as_parsed(s)) for s in scripts) + '; style-src ' +
            sha(as_parsed(styles[0])) + ' ' + CSP_TAIL)


def module(mid, deps=(), body='  return {};'):
    dep_list = ', '.join("'%s'" % d for d in deps)
    return HEADER + "MV.def('%s', [%s], () => {\n  'use strict';\n%s\n});\n" % (mid, dep_list, body)


class Tree:
    """A throwaway copy of the tree (full source, or only the kernel plus given files) with vendor/ in it."""

    def __init__(self, full=False, files=None):
        self.tmp = Path(tempfile.mkdtemp(prefix='mv-build-'))
        self.root = self.tmp / 'tree'
        shutil.copytree(REPO / 'vendor', self.root / 'vendor')
        if full:
            shutil.copytree(REPO / 'src', self.root / 'src')
        else:
            (self.root / 'src' / 'core').mkdir(parents=True)
            shutil.copy(REPO / 'src' / 'core' / 'define.js', self.root / 'src' / 'core' / 'define.js')
        for rel, text in (files or {}).items():
            self.write(rel, text)

    def write(self, rel, text):
        path = self.root / 'src' / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')

    def remove(self, rel):
        (self.root / 'src' / rel).unlink()

    def close(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


def inline_blocks(html):
    scripts = re.findall(r'<script>(.*?)</script>', html, re.S)
    styles = re.findall(r'<style>(.*?)</style>', html, re.S)
    return scripts, styles


def csp_of(html):
    m = re.search(r'<meta http-equiv="Content-Security-Policy" content="([^"]*)">', html)
    return m.group(1) if m else None


class FullBuild(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tree = Tree(full=True)
        code, out = run_build(cls.tree.root, '--lab')
        assert code == 0, out
        cls.pages = {rel: (cls.tree.root / rel).read_bytes() for rel in ('index.html', 'en/index.html', 'tests/www/lab.html')}

    @classmethod
    def tearDownClass(cls):
        cls.tree.close()

    def test_rebuild_is_byte_identical(self):
        code, out = run_build(self.tree.root, '--lab')
        self.assertEqual(code, 0, out)
        for rel, first in self.pages.items():
            self.assertEqual((self.tree.root / rel).read_bytes(), first, rel)

    def test_csp_hashes_match_the_inline_blocks(self):
        for rel, raw in self.pages.items():
            html = raw.decode('utf-8')
            scripts, styles = inline_blocks(html)
            self.assertEqual(len(scripts), 3, rel)
            self.assertEqual(len(styles), 1, rel)
            self.assertEqual(csp_of(html), expected_csp(scripts, styles), rel)
            self.assertNotIn('\r', html, rel)
            self.assertNotIn('\x00', html, rel)

    def test_page_structure_and_languages(self):
        ja = self.pages['index.html'].decode('utf-8')
        en = self.pages['en/index.html'].decode('utf-8')
        lab = self.pages['tests/www/lab.html'].decode('utf-8')
        self.assertTrue(ja.startswith('<!doctype html><html lang="ja"><head><meta charset="utf-8">\n'))
        self.assertIn('<title>文字PVメーカー</title>', ja)
        self.assertTrue(en.startswith('<!doctype html><html lang="en">'))
        self.assertIn('<title>Moji PV Maker</title>', en)
        self.assertIn('<body><div id="app"></div>\n<script>', ja)
        self.assertTrue(ja.endswith('</script></body></html>\n'))
        self.assertNotIn('\r', ja)
        app_ja, app_en, app_lab = inline_blocks(ja)[0][2], inline_blocks(en)[0][2], inline_blocks(lab)[0][2]
        kernel = (REPO / 'src' / 'core' / 'define.js').read_text(encoding='utf-8').rstrip('\n')
        self.assertTrue(app_ja.startswith(kernel + "\nMV.DEV=false;MV.LANG='ja';\n"))
        self.assertTrue(app_en.startswith(kernel + "\nMV.DEV=false;MV.LANG='en';\n"))
        self.assertTrue(app_lab.startswith(kernel + "\nMV.DEV=true;MV.LANG='ja';\n"))
        self.assertTrue(app_ja.endswith("MV.use('ui/boot').start();\n"))
        self.assertTrue(app_lab.endswith("MV.use('ui/lab').start();\n"))

    def test_vendor_scripts_come_first_and_unmodified(self):
        scripts = inline_blocks(self.pages['index.html'].decode('utf-8'))[0]
        for i, name in enumerate(('mp4-muxer.min.js', 'ai-sdk.min.js')):
            self.assertEqual(scripts[i], as_parsed((REPO / 'vendor' / name).read_bytes().decode('utf-8')), name)

    def test_modules_follow_their_dependencies(self):
        app = inline_blocks(self.pages['index.html'].decode('utf-8'))[0][2]
        heads = re.findall(r"MV\.def\('([^']+)',\s*\[([^\]]*)\]", app)
        seen = set()
        for mid, deps in heads:
            for dep in re.findall(r"'([^']+)'", deps):
                self.assertIn(dep, seen, '%s comes before its dependency %s' % (mid, dep))
            seen.add(mid)
        self.assertEqual(len(heads), len(set(m for m, _ in heads)))


class Check(unittest.TestCase):
    def check(self, files, *expected, ok=False, extra_args=()):
        tree = Tree(files=files)
        try:
            code, out = run_build(tree.root, '--check', *extra_args)
            if ok:
                self.assertEqual(code, 0, out)
            else:
                self.assertEqual(code, 1, out)
            for fragment in expected:
                self.assertRegex(out, fragment)
            self.assertFalse((tree.root / 'index.html').exists(), '--check writes nothing')
            return out
        finally:
            tree.close()

    def test_minimal_tree_passes(self):
        out = self.check({'core/a.js': module('core/a'), 'i18n/b.js': module('i18n/b', ['core/a'])}, ok=True)
        self.assertIn('OK', out)

    def test_reports_use_path_line_rule(self):
        self.check({'core/a.js': module('core/a', body='  const r = Math.random();\n  return { r };')},
                   r'src/core/a\.js:4: lint Math\.random')

    def test_pure_layer_bans(self):
        for snippet, rule in [('Date.now()', 'Date'), ('new Date()', 'Date'), ('Date()', 'Date'),
                              ('Reflect.construct(Date, [])', 'Date'), ('performance.now()', 'performance.now'),
                              ('new Intl.Segmenter()', 'Intl.Segmenter'), ('setTimeout(f, 1)', 'setTimeout'),
                              ('setInterval(f, 1)', 'setInterval'), ('requestAnimationFrame(f)', 'requestAnimationFrame'),
                              ('fetch(url)', r'fetch\('), ('document.body', 'document'), ('window.x', 'window'),
                              ('navigator.language', 'navigator'), ('localStorage.x', 'localStorage'),
                              ('sessionStorage.x', 'sessionStorage'), ('indexedDB.open()', 'indexedDB'),
                              # the middle operand of a ternary and a spread are values, not object keys or properties
                              ("typeof x === 'undefined' ? document : null", 'document'), ('ok ? localStorage : null', 'localStorage'),
                              ('ok ? setTimeout : null', 'setTimeout'), ('ok ? Date : null', 'Date'), ('{ ...navigator }', 'navigator')]:
            with self.subTest(snippet=snippet):
                body = '  function f(ok, x, url) { return %s; }\n  return { f };' % snippet
                self.check({'planner/p.js': module('planner/p', body=body)}, r'p\.js:4: lint ' + rule + r' \(L0–L5\)')

    def test_comments_strings_and_local_bindings_are_not_flagged(self):
        body = ("  // Math.random() and new Date() in a comment\n"
                "  /* window.document */\n"
                "  const s = 'Date.now() document.write eval(';\n"
                "  const re = /window\\.x/;\n"
                "  const tpl = `setTimeout ${1 + 2} fetch(`;\n"
                "  function fit({ dur, window }) { return dur * window; }\n"
                "  const o = { window: 1, document: 2 };\n"
                "  return { s, re, tpl, fit, o, rand: (rng) => rng.random(), f: (api) => api.fetch(1) };")
        self.check({'core/c.js': module('core/c', body=body)}, ok=True)

    def test_local_bindings_shadow_a_browser_global_only_in_their_scope(self):
        # fitMotion's FROZEN option is named `window` (§4.7), so callers bind it locally (NOTES "fitMotion and the
        # window lint"); that must not open the rest of the file to the global.
        ok = ("  function hero(cut, M) {\n"
              "    const a = cut.a, b = cut.b, window = b - a;\n"
              "    return M.fitMotion({ dur: 1, each: 0, count: 1, window, share: 0.4 }) + window / 2;\n"
              "  }\n"
              "  function fit({ dur, window = 1 }) { return dur / window; }\n"
              "  const half = (window) => window / 2, third = window => window / 3;\n"
              "  function sum(xs) { let s = 0; for (const window of xs) s += window; return s; }\n"
              "  const keyed = (cut) => ({ window: cut.b - cut.a, document: 1 });\n"
              "  return { hero, fit, half, third, sum, keyed };")
        self.check({'planner/p.js': module('planner/p', body=ok)}, ok=True)
        bad = [
            # the reviewer's probe: a local `window` elsewhere in the file used to disable the rule for the whole file
            ("  function hero(cut, M) {\n    const window = cut.b - cut.a;\n    return M.fitMotion({ window });\n  }\n"
             "  function leak(key) { return window.localStorage.getItem(key) + window.fetch('https://x'); }", 8, 'window'),
            ("  function a(cut) { const window = cut.b - cut.a; return window; }\n"
             "  function b(keep) { return keep(window); }", 5, 'window'),
            ("  function a(cut) { const window = cut.b; return window.toFixed(2); }", 4, 'window'),
            ("  function a(cut) {\n    const document = cut.doc;\n    return document.body;\n  }", 6, 'document'),
            ("  function a(w = window) { return w; }", 4, 'window'),
            ("  function a({ window: w }) { return w + window; }", 4, 'window'),
            ("  const half = (window) => window / 2;\n  const again = () => window;", 5, 'window'),
            ("  function a(xs) { for (const window of xs) { xs.push(window); } return window; }", 4, 'window'),
            ("  function a(cut) { if (cut) { const navigator = 1; return navigator; } return navigator; }", 4, 'navigator'),
        ]
        for body, line, name in bad:
            with self.subTest(body=body):
                src = module('planner/p', body=body + '\n  return {};')
                out = self.check({'planner/p.js': src}, r'p\.js:%d: lint %s \(L0–L5\)' % (line, name))
                self.assertEqual(out.count('lint'), 1, out)
        self.check({'ai/x.js': module('ai/x', body="  const pick = (ok) => (ok ? document : null);\n"
                                                   "  function a(cut) { const window = cut.w; return window; }\n"
                                                   "  const leak = () => window.indexedDB;\n  return { pick, a, leak };")},
                   r'x\.js:4: lint document \(ai\)', r'x\.js:6: lint window \(ai\)')

    def test_everywhere_bans(self):
        for snippet, rule in [('eval("1")', r'eval\('), ('new Function("x")', 'new Function'), ('require("x")', r'require\('),
                              ('el.innerHTML = s', r'\.innerHTML'), ('el.outerHTML', r'\.outerHTML'),
                              ('el.insertAdjacentHTML("x", s)', 'insertAdjacentHTML'), ('document.write(s)', 'document.write'),
                              ("el.setAttribute('style', s)", "setAttribute\\('style'"), ('import("x")', r'import\(')]:
            with self.subTest(snippet=snippet):
                body = '  function f(el, s) { return %s; }\n  return { f };' % snippet
                self.check({'ui/u.js': module('ui/u', body=body)}, 'lint ' + rule)
        self.check({'ui/h.js': module('ui/h', body="  const html = '<b onclick=\"x()\">';\n  return { html };")},
                   'on…= handler')
        self.check({'ui/w.js': module('ui/w', body='  with (Math) { max(1, 2); }\n  return {};')}, r'lint with \(')
        # methods with those names are not the banned statement or globals (Array.prototype.with keeps sharing, §3.9)
        members = ("  function f(rows, o, x) {\n    const a = rows.with(0, x);\n    return [a, o.import(1), o.eval(2), o.require(3),\n"
                   "      rows\n        .with(1, x)];\n  }\n  return { f };")
        self.check({'core/m.js': module('core/m', body=members)}, ok=True)

    def test_ai_and_host_rules(self):
        ai = module('ai/x', body='  function f(api) { setTimeout(api, 5); return api.fetch(1); }\n  return { f };')
        self.check({'ai/x.js': ai}, ok=True)
        self.check({'ai/y.js': module('ai/y', body='  const r = () => Math.random();\n  return { r };')}, 'Math.random')
        self.check({'ai/z.js': module('ai/z', body='  const r = () => window.x;\n  return { r };')}, r'lint window \(ai\)')
        host = module('engine/host/canvas', body='  function create() { return document.createElement("canvas"); }\n  return { create };')
        self.check({'engine/host/canvas.js': host}, ok=True)

    def test_layer_violations(self):
        cases = [
            ({'core/a.js': module('core/a', ['planner/p']), 'planner/p.js': module('planner/p')}, r'layer: core/a → planner/p'),
            ({'planner/p.js': module('planner/p', ['engine/scene/s']), 'engine/scene/s.js': module('engine/scene/s')},
             r'layer: planner/p → engine/scene/s'),
            ({'planner/p.js': module('planner/p', ['engine/text/layout']), 'engine/text/layout.js': module('engine/text/layout')},
             'only engine/text/breaker, vert and faces'),
            ({'planner/p.js': module('planner/p', ['engine/text/service']), 'engine/text/service.js': module('engine/text/service')},
             'only engine/text/breaker, vert and faces'),
            ({'engine/text/a.js': module('engine/text/a', ['audio/d']), 'audio/d.js': module('audio/d')}, r'layer: engine/text/a → audio/d'),
            ({'engine/render/r.js': module('engine/render/r', ['planner/p']), 'planner/p.js': module('planner/p')},
             r'layer: engine/render/r → planner/p'),
            ({'parts/arrive/soft.js': module('parts/arrive/soft', ['core/num']), 'core/num.js': module('core/num')},
             'part files may depend only on parts/kit'),
            ({'parts/catalog.js': module('parts/catalog', ['core/num']), 'core/num.js': module('core/num')},
             'parts/catalog may depend only on core/registry'),
            ({'export/muxer.js': module('export/muxer', ['export/host/mp4']), 'export/host/mp4.js': module('export/host/mp4')},
             r'layer: export/muxer → export/host/mp4'),
            ({'engine/host/fonts.js': module('engine/host/fonts', ['ui/dom']), 'ui/dom.js': module('ui/dom')},
             'only ui/\\* may depend on ui/\\*'),
            ({'misc/thing.js': module('misc/thing')}, 'layer: no layer for module misc/thing'),
        ]
        for files, fragment in cases:
            with self.subTest(fragment=fragment):
                self.check(files, fragment)
        allowed = {'planner/p.js': module('planner/p', ['engine/text/breaker', 'engine/text/vert', 'engine/text/faces', 'core/a',
                                                        'audio/d']),
                   'engine/text/breaker.js': module('engine/text/breaker', ['core/a']), 'core/a.js': module('core/a'),
                   'engine/text/vert.js': module('engine/text/vert', ['core/a']),
                   'engine/text/faces.js': module('engine/text/faces', ['core/a']),
                   'audio/d.js': module('audio/d'), 'ui/x.js': module('ui/x', ['planner/p', 'engine/host/c']),
                   'engine/host/c.js': module('engine/host/c', ['engine/facade']), 'engine/facade.js': module('engine/facade', ['planner/p'])}
        self.check(allowed, ok=True)

    def test_parts_mix_is_l3(self):
        # DESIGN_2_1 §2.3: parts/mix is L3 (like parts/kit): L0, L1 and L3 only; not a part file; no part depends on it.
        mix = {'parts/mix.js': module('parts/mix', ['core/a', 'i18n/b', 'parts/kit', 'engine/scene/s']),
               'parts/kit.js': module('parts/kit', ['core/a']), 'core/a.js': module('core/a'),
               'i18n/b.js': module('i18n/b', ['core/a']), 'engine/scene/s.js': module('engine/scene/s', ['core/a'])}
        self.check(mix, ok=True)
        self.check({'parts/mix.js': module('parts/mix', ['planner/p']), 'planner/p.js': module('planner/p')},
                   r'layer: parts/mix → planner/p')
        self.check({'parts/mix.js': module('parts/mix', ['engine/facade']), 'engine/facade.js': module('engine/facade')},
                   r'layer: parts/mix → engine/facade')
        self.check({'parts/mix.js': module('parts/mix', body='  const r = () => Math.random();\n  return { r };')},
                   r'src/parts/mix\.js:4: lint Math\.random')
        self.check({'parts/arrive/soft.js': module('parts/arrive/soft', ['parts/mix']), 'parts/mix.js': module('parts/mix')},
                   'part files may depend only on parts/kit')
        self.check({'engine/facade.js': module('engine/facade', ['parts/mix']), 'parts/mix.js': module('parts/mix')}, ok=True)

    def test_media_layers(self):
        # DESIGN_2_1 §11.3.1: media/* is L1 (core/* and media/* only; pure); media/host/* is L6; the engine never uses media/*.
        media = {'core/a.js': module('core/a'), 'media/samples.js': module('media/samples', ['core/a']),
                 'media/isobmff.js': module('media/isobmff', ['core/a', 'media/samples']),
                 'media/host/probe.js': module('media/host/probe', ['media/isobmff', 'export/unzip', 'core/a'],
                                               body='  function f() { return document.createElement("canvas").getContext("2d").getImageData(0, 0, 1, 1); }\n  return { f };'),
                 'export/unzip.js': module('export/unzip', ['core/a']),
                 'ui/x.js': module('ui/x', ['media/host/probe', 'media/samples']),
                 # §11.3.4 / §11.4.6: media/yuv (the pure YUV → RGBA copy, L1) and media/host/bake (its host glue: ctx.filter,
                 # putImageData, L6) under the same prefix rules
                 'media/yuv.js': module('media/yuv', ['core/a']),
                 'media/host/bake.js': module('media/host/bake', ['media/yuv'],
                                              body='  function f(g, d) { g.putImageData(d, 0, 0); g.filter = "blur(1px)"; return performance.now(); }\n  return { f };')}
        self.check(media, ok=True)
        cases = [
            ({'media/sniff.js': module('media/sniff', ['i18n/b']), 'i18n/b.js': module('i18n/b')}, r'layer: media/sniff → i18n/b'),
            ({'media/sniff.js': module('media/sniff', ['audio/d']), 'audio/d.js': module('audio/d')}, r'layer: media/sniff → audio/d'),
            ({'media/sniff.js': module('media/sniff', ['media/host/probe']), 'media/host/probe.js': module('media/host/probe')},
             r'layer: media/sniff → media/host/probe'),
            ({'audio/d.js': module('audio/d', ['media/sniff']), 'media/sniff.js': module('media/sniff')}, r'layer: audio/d → media/sniff'),
            ({'export/package.js': module('export/package', ['media/host/store']), 'media/host/store.js': module('media/host/store')},
             r'layer: export/package → media/host/store'),
            ({'engine/render/shapes.js': module('engine/render/shapes', ['media/samples']), 'media/samples.js': module('media/samples')},
             r'layer: engine/render/shapes → media/samples \(the engine never depends on media'),
            ({'engine/facade.js': module('engine/facade', ['media/samples']), 'media/samples.js': module('media/samples')},
             r'layer: engine/facade → media/samples'),
            ({'media/host/store.js': module('media/host/store', ['ui/dom']), 'ui/dom.js': module('ui/dom')},
             'only ui/\\* may depend on ui/\\*'),
            ({'media/palette.js': module('media/palette', body='  const r = () => Math.random();\n  return { r };')},
             r'src/media/palette\.js:4: lint Math\.random \(L0–L5\)'),
            ({'media/sniff.js': module('media/sniff', body='  const f = () => document.title;\n  return { f };')},
             r'src/media/sniff\.js:4: lint document \(L0–L5\)'),
            ({'media/samples.js': module('media/samples', body='  const f = (g) => setTimeout(g, 1);\n  return { f };')},
             r'lint setTimeout \(L0–L5\)'),
            ({'media/yuv.js': module('media/yuv', ['media/host/bake']), 'media/host/bake.js': module('media/host/bake')},
             r'layer: media/yuv → media/host/bake'),
            ({'engine/render/shapes.js': module('engine/render/shapes', ['media/yuv']), 'media/yuv.js': module('media/yuv')},
             r'layer: engine/render/shapes → media/yuv \(the engine never depends on media'),
            ({'media/yuv.js': module('media/yuv', body='  const f = () => performance.now();\n  return { f };')},
             r'src/media/yuv\.js:4: lint performance\.now \(L0–L5\)'),
        ]
        for files, fragment in cases:
            with self.subTest(fragment=fragment):
                self.check(files, fragment)

    def test_part_file_rules(self):
        kit = module('parts/kit')

        def part(body):
            return HEADER + "MV.def('parts/arrive/x', ['parts/kit'], (K) => {\n%s\n});\n" % body
        self.check({'parts/kit.js': kit, 'parts/arrive/x.js': part('  let count = 0;\n  return [];')},
                   r'x\.js:3: lint module-level mutable state \(let\)')
        self.check({'parts/kit.js': kit, 'parts/arrive/x.js': part(
            '  function f() { let n = 0; for (let i = 0; i < 2; i++) n++; return n; }\n  const a = 1;\n  return [f, a];')}, ok=True)
        self.check({'parts/kit.js': kit, 'parts/arrive/x.js': part('  function f(g) { g.filter = "blur(2px)"; }\n  return [f];')},
                   'ctx.filter assignment')
        self.check({'parts/kit.js': kit, 'parts/arrive/x.js': part('  function f(g) { return g.getImageData(0, 0, 1, 1); }\n  return [f];')},
                   'getImageData')
        self.check({'engine/render/d.js': module('engine/render/d', body='  const f = (g) => g.putImageData(1);\n  return { f };')},
                   'putImageData')
        fn_ok = part("  return [{ params: { a: { auto: { fn: (f, rng, look) => K.math.clamp(f.energy * 2 + rng.next(), 0, "
                     "Math.max(1, look.amounts.motion)), why: { ja: 'x', en: 'x' } } } } }];")
        self.check({'parts/kit.js': kit, 'parts/arrive/x.js': fn_ok}, ok=True)
        fn_bad = part("  const scale = 3;\n  return [{ params: { a: { auto: { fn: (f) => f.energy * scale, why: {} } } } }];")
        self.check({'parts/kit.js': kit, 'parts/arrive/x.js': fn_bad}, 'lint fn auto uses scale')
        fn_block = part("  function helper() { return 1; }\n  return [{ params: { a: { auto: { fn: function (f, rng) {\n"
                        "    const k = rng.next();\n    return helper() + k;\n  }, why: {} } } } }];")
        self.check({'parts/kit.js': kit, 'parts/arrive/x.js': fn_block}, r'x\.js:6: lint fn auto uses helper')
        # every other way to write the function: method shorthand, a reference, a default value, a spread
        for auto, rule in [('fn(f) { return cache.size + f.cells; }', 'fn auto uses cache'),
                           ('fn: outside', 'fn auto must be an inline function literal'),
                           ('fn: K.helpers.outside', 'fn auto must be an inline function literal'),
                           ('fn: make()', 'fn auto must be an inline function literal'),
                           ('fn', 'fn auto must be an inline function literal'),
                           ('fn: (f, x = cache) => x.size', 'fn auto uses cache'),
                           ('fn: (f) => Math.max(...cache.keys())', 'fn auto uses cache'),
                           ('fn: (f) => ({ cache })', 'fn auto uses cache')]:
            with self.subTest(auto=auto):
                body = ("  const cache = new Map();\n  function outside(f) { return cache.size + f.cells; }\n"
                        "  return [{ params: { a: { auto: { %s, why: {} } } } }];" % auto)
                self.check({'parts/kit.js': kit, 'parts/arrive/x.js': part(body)}, r'x\.js:5: lint ' + re.escape(rule))
        fn_locals = part("  function outside(f) { return f.cells; }\n  return [{ params: {\n"
                         "    a: { auto: { fn: (f, rng) => { const { energy, cells: c } = f; return K.clamp(energy + c * rng.next()); }, why: {} } },\n"
                         "    b: { auto: { fn: f => f.energy, why: {} } },\n"
                         "    c: { auto: { fn: function (f) { let s = 0; for (const k of [1, 2]) s += k * f.energy; return s; }, why: {} } },\n"
                         "    d: { auto: { fn(f, rng, look) { return look.amounts.motion * rng.next() + f.energy; }, why: {} } },\n"
                         "  }, make: K.moves(1, outside) }];")
        self.check({'parts/kit.js': kit, 'parts/arrive/x.js': fn_locals}, ok=True)

    def test_module_shape_errors(self):
        self.check({'core/a.js': "MV.def('core/a', [], () => ({}));\n"}, r'core/a\.js:1: header')
        self.check({'core/a.js': module('core/b')}, "def-id: 'core/b' does not match its path 'core/a'")
        self.check({'core/a.js': HEADER + "const x = 1;\nMV.def('core/a', [], () => ({ x }));\n"}, 'outside-def')
        self.check({'core/a.js': module('core/a') + 'MV.use("core/a");\n'}, 'one-def|outside-def')
        self.check({'core/a.js': module('core/a') + module('core/a2').replace(HEADER, '')}, 'one-def: exactly one MV.def')
        self.check({'core/a.js': HEADER + "const d = ['core/b'];\nMV.def('core/a', d, () => ({}));\n"}, 'outside-def|def-header')
        self.check({'core/a.js': HEADER + "MV.def('core/a', ['core/' + 'b'], () => ({}));\n"}, 'deps: dependencies must be string literals')
        self.check({'core/a.js': module('core/a', ['core/missing'])}, 'missing-dep: core/missing')
        self.check({'core/Bad.js': module('core/Bad')}, 'module id')
        self.check({'core/a.js': HEADER + "function f() {}\n"}, 'one-def: exactly one MV.def')

    def test_cycles(self):
        out = self.check({'core/a.js': module('core/a', ['core/b']), 'core/b.js': module('core/b', ['core/c']),
                          'core/c.js': module('core/c', ['core/a'])}, 'cycle: core/a → core/b → core/c → core/a')
        self.assertEqual(out.count('cycle:'), 1)

    def test_style_header_and_close_tag(self):
        self.check({'ui/style.css': '/* 文字PVメーカー v2 — original work. */\nbody{margin:0}\n'}, ok=True)
        self.check({'ui/style.css': 'body{margin:0}\n'}, 'header')
        self.check({'ui/style.css': '/* 文字PVメーカー v2 — original work. */\n</style>\n'}, 'may not contain </style')


class Pages(unittest.TestCase):
    def test_builds_with_empty_layers_and_needs_the_boot_module(self):
        boot = module('ui/boot', ['i18n/t'], "  return { start() { return 1; } };")
        tree = Tree(files={'i18n/t.js': module('i18n/t'), 'ui/boot.js': boot})
        try:
            code, out = run_build(tree.root)
            self.assertEqual(code, 0, out)
            self.assertTrue((tree.root / 'index.html').is_file())
            self.assertTrue((tree.root / 'en' / 'index.html').is_file())
            self.assertFalse((tree.root / 'tests' / 'www' / 'lab.html').exists())
            code, out = run_build(tree.root, '--lab')
            self.assertEqual(code, 1, out)
            self.assertIn('boot: module ui/lab is required', out)
            tree.remove('ui/boot.js')
            code, out = run_build(tree.root, '--check')
            self.assertEqual(code, 0, out)
            code, out = run_build(tree.root)
            self.assertEqual(code, 1)
            self.assertIn('boot: module ui/boot is required', out)
        finally:
            tree.close()

    def test_line_endings_are_normalized_before_hashing(self):
        # The browser checks the CSP hash of the text after the HTML parser turned CRLF and a lone CR into LF, so a
        # CRLF checkout (core.autocrlf) or a stray CR must not leave the page with hashes of other text.
        boot = module('ui/boot', body="  /* a comment\rwith a lone CR */\r\n  return { start() { return 1; } };\r\n")
        css = '/* 文字PVメーカー v2 — original work. */\r\nbody{margin:0}\rp{margin:0}\r\n'
        tree = Tree(files={'ui/boot.js': boot, 'ui/lab.js': module('ui/lab', body='  return { start() {} };'), 'ui/style.css': css})
        try:
            vendor = tree.root / 'vendor' / 'mp4-muxer.min.js'
            original = vendor.read_bytes().decode('utf-8')
            vendor.write_bytes(original.replace('\n', '\r\n').encode('utf-8'))
            code, out = run_build(tree.root, '--lab')
            self.assertEqual(code, 0, out)
            for rel in ('index.html', 'en/index.html', 'tests/www/lab.html'):
                html = (tree.root / rel).read_bytes().decode('utf-8')
                self.assertNotIn('\r', html, rel)
                scripts, styles = inline_blocks(html)
                self.assertEqual(csp_of(html), expected_csp(scripts, styles), rel)
                self.assertEqual(scripts[0], original, rel + ': vendor text unchanged apart from line endings')
                self.assertIn('/* a comment\nwith a lone CR */\n', scripts[2], rel)
                self.assertEqual(styles[0], '/* 文字PVメーカー v2 — original work. */\nbody{margin:0}\np{margin:0}\n', rel)
        finally:
            tree.close()

    def test_text_the_parser_would_change_fails_the_build(self):
        cases = [({'ui/boot.js': module('ui/boot', body="  const s = 'a\x00b';\n  return { start() { return s; } };")},
                  'inline: app script contains a NUL character'),
                 ({'ui/boot.js': module('ui/boot', body='  return { start() {} };'),
                   'ui/style.css': '/* 文字PVメーカー v2 — original work. */\nb{content:"\x00"}\n'},
                  'inline: style.css may not contain a NUL character')]
        for files, message in cases:
            with self.subTest(message=message):
                tree = Tree(files=files)
                try:
                    code, out = run_build(tree.root)
                    self.assertEqual(code, 1, out)
                    self.assertIn(message, out)
                finally:
                    tree.close()
        tree = Tree(files={'ui/boot.js': module('ui/boot', body='  return { start() {} };')})
        try:
            (tree.root / 'vendor' / 'ai-sdk.min.js').write_bytes(b'/* \xff */\n')
            code, out = run_build(tree.root)
            self.assertEqual(code, 1, out)
            self.assertIn('vendor/ai-sdk.min.js:1: encoding: not UTF-8', out)
        finally:
            tree.close()

    def test_a_closing_script_tag_in_the_app_fails_the_build(self):
        boot = module('ui/boot', body="  const s = '</script>';\n  return { start() { return s; } };")
        tree = Tree(files={'ui/boot.js': boot})
        try:
            code, out = run_build(tree.root)
            self.assertEqual(code, 1, out)
            self.assertIn('inline: app script contains </script', out)
        finally:
            tree.close()


if __name__ == '__main__':
    unittest.main(verbosity=1)
