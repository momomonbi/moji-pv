"""Check that v2 (next/) shares no code with JIZURA.
Both sides are tokenized (identifiers, numbers, strings, operators; comments and whitespace dropped). Any run of
MIN_RUN or more identical tokens that appears in both is reported. Runs made only of very common tokens
(brackets, commas, keywords, single-letter names) are ignored.
usage: python3 dev/originality_check.py [--min-run 24] [--show 20]      (exit 1 if a shared run is found)"""
import glob, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIN_RUN = int(sys.argv[sys.argv.index('--min-run') + 1]) if '--min-run' in sys.argv else 24
SHOW = int(sys.argv[sys.argv.index('--show') + 1]) if '--show' in sys.argv else 20

JIZURA = (['src/0%s' % x for x in ['1_util.js', '2_fonts.js', '2b_lang.js', '3_text.js', '4_styles.js', '5_anim.js', '5b_registry.js',
                                    '6_layouts.js', '7_decor.js', '8_planner.js', '8b_omakase.js', '9_render.js']]
          + ['src/10_audio.js', 'src/11_export.js', 'src/11q_sets.js', 'src/12_ui.js', 'app/body.html', 'app/style.css', 'app/english.js', 'app/english.py', 'build.py']
          + sorted(glob.glob(os.path.join(ROOT, 'src/11p_*.js'))))
V2 = [p for p in glob.glob(os.path.join(ROOT, 'next/**/*'), recursive=True)
      if os.path.isfile(p) and p.endswith(('.js', '.py', '.css', '.html')) and '/node_modules/' not in p
      and not p.endswith(('next/index.html', 'next/en/index.html')) and '/vendor/' not in p]

TOKEN = re.compile(r"""
    (?P<comment>//[^\n]*|/\*.*?\*/|\#[^\n]*)
  | (?P<str>'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)
  | (?P<num>\d+(?:\.\d+)?(?:e[+-]?\d+)?)
  | (?P<id>[A-Za-z_$][\w$]*)
  | (?P<op>[^\s\w])
""", re.S | re.X)
COMMON = set('( ) [ ] { } , ; . : = + - * / < > ! ? & | const let var function return if else for of in new this true false null undefined => ==='.split())


def tokens(path):
    src = open(path, encoding='utf-8', errors='replace').read()
    out = []
    for m in TOKEN.finditer(src):
        kind = m.lastgroup
        if kind == 'comment': continue
        t = m.group(kind)
        if kind == 'op' and t == '#': continue
        out.append(t)
    return out


def interesting(run):
    return sum(1 for t in run if t not in COMMON and len(t) > 1) >= MIN_RUN // 3


def main():
    jiz = {}
    for rel in JIZURA:
        p = rel if os.path.isabs(rel) else os.path.join(ROOT, rel)
        if os.path.exists(p): jiz[os.path.relpath(p, ROOT)] = tokens(p)
    index = {}
    for name, toks in jiz.items():
        for i in range(len(toks) - MIN_RUN + 1):
            index.setdefault(tuple(toks[i:i + MIN_RUN]), (name, i))
    hits = []
    for p in V2:
        toks = tokens(p)
        i = 0
        while i <= len(toks) - MIN_RUN:
            key = tuple(toks[i:i + MIN_RUN])
            if key in index and interesting(key):
                j = i + MIN_RUN
                while j < len(toks) and j - i < 400: j += 1   # extent is only indicative
                hits.append((os.path.relpath(p, ROOT), i, index[key][0], ' '.join(key)[:160]))
                i += MIN_RUN
            else:
                i += 1
    print(f'v2 files: {len(V2)}, JIZURA files: {len(jiz)}, window: {MIN_RUN} tokens')
    for h in hits[:SHOW]:
        print(f'  SHARED  {h[0]} (token {h[1]}) ~ {h[2]}: {h[3]}')
    if hits:
        print(f'{len(hits)} shared run(s). v2 must not copy JIZURA code.')
        sys.exit(1)
    print('originality check OK: no shared code runs')


main()
