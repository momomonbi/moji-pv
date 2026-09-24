"""Check that the English edition's glossary (app/english.py + app/english.js) covers every Japanese UI string.
Looks at what the English build would ship:
  - app/body.html after localize_body: visible text and title / placeholder / aria-label / alt attributes
  - UI script files after localize_js (string literals and template parts, comments ignored)
  - engine labels after app/english.js (technique names, style names and descriptions, moods, sample lyrics)
Strings that are meant to stay Japanese are listed in dev/english_allow.txt (one per line, exact text).
usage: (cd dev && npm ci) && python3 dev/check_english.py      -> exit 1 if anything is left untranslated"""
import glob, html.parser, json, os, re, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from app.english import localize_body, localize_js

JA = re.compile(r'[぀-ヿ㐀-鿿ｦ-ﾟ]')
# UI files whose strings reach the screen; engine files outside this list only feed labels checked at runtime
UI_FILES = ['src/12_ui.js', 'src/11_export.js', 'src/13_ai_ui.js']
ALLOW_FILE = os.path.join(ROOT, 'dev', 'english_allow.txt')
allow = set()
if os.path.exists(ALLOW_FILE):
    allow = {l.rstrip('\n') for l in open(ALLOW_FILE, encoding='utf-8') if l.strip() and not l.startswith('#')}


class Texts(html.parser.HTMLParser):
    ATTRS = {'title', 'placeholder', 'aria-label', 'alt'}

    def __init__(self):
        super().__init__(); self.found = []; self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'): self.skip += 1
        for k, v in attrs:
            if k in self.ATTRS and v and JA.search(v): self.found.append((f'<{tag} {k}>', v))

    def handle_endtag(self, tag):
        if tag in ('script', 'style'): self.skip -= 1

    def handle_data(self, data):
        t = data.strip()
        if t and not self.skip and JA.search(t): self.found.append(('text', t))


def main():
    left = []
    body = localize_body(open(os.path.join(ROOT, 'app/body.html'), encoding='utf-8').read())
    p = Texts(); p.feed(body)
    left += [('app/body.html', where, t) for where, t in p.found]

    with tempfile.TemporaryDirectory() as tmp:
        files = []
        for f in UI_FILES:
            if not os.path.exists(os.path.join(ROOT, f)): continue
            dst = os.path.join(tmp, os.path.basename(f))
            open(dst, 'w', encoding='utf-8').write(localize_js(open(os.path.join(ROOT, f), encoding='utf-8').read(), f))
            files.append(dst)
        node = lambda *a: json.loads(subprocess.run(['node', os.path.join(ROOT, 'dev/check_english_js.js'), *a], cwd=ROOT, check=True, capture_output=True, text=True).stdout)
        for r in node('literals', *files):
            left.append((f"src/{os.path.basename(r['file'])}", f"line {r['line']}", r['text']))
    for r in node('runtime'):
        left.append(('engine labels', r['where'], r['text']))

    missing = [(f, w, t) for f, w, t in left if t.strip() not in allow and t not in allow]
    used_allow = {t.strip() for _, _, t in left} | {t for _, _, t in left}
    unused = sorted(a for a in allow if a not in used_allow)
    print(f'Japanese strings in the English build: {len(left)} (allowed {len(left) - len(missing)}, missing {len(missing)})')
    for f, w, t in missing:
        print(f'  MISSING  {f} {w}: {t[:120]!r}')
    for a in unused:
        print(f'  note: allow-list entry no longer used: {a!r}')
    if missing:
        print('Add the translation to app/english.py (BODY / UI / EXPORT / AI) or app/english.js, '
              'or list the exact text in dev/english_allow.txt if it must stay Japanese.')
        sys.exit(1)
    print('English glossary OK')


main()
