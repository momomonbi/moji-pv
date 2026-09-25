#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Build: lint, layer check, topological sort, inline, CSP and pages (DESIGN §2.3–§2.6).

    python3 build.py            writes index.html and en/index.html
    python3 build.py --check    lint + layers + topo only; exit 1 on any problem; writes nothing
    python3 build.py --lab      also writes tests/www/lab.html (MV.DEV=true; boots 'ui/lab')

For tests, --root DIR builds another copy of the tree (DIR/src and DIR/vendor; the pages are written under DIR).
Standard library only. The output is byte-identical for identical inputs.
"""
import argparse
import base64
import functools
import hashlib
import heapq
import re
import sys
from bisect import bisect_right
from pathlib import Path

HEADER = '/* 文字PVメーカー v2 — original work.'
VENDOR_FILES = ('mp4-muxer.min.js', 'ai-sdk.min.js')
PART_KINDS = ('arrange', 'arrive', 'dwell', 'depart', 'ground', 'ornament', 'lens', 'filter', 'seam', 'theme', 'mood')
CSP = ("default-src 'none'; script-src {scripts}; style-src {style} https://fonts.googleapis.com; "
       "font-src https://fonts.gstatic.com; connect-src https://generativelanguage.googleapis.com "
       "https://api.anthropic.com; img-src data: blob:; media-src blob:; worker-src 'none'; base-uri 'none'; "
       "form-action 'none'")
PAGE = ('<!doctype html><html lang="{lang}"><head><meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        '<meta http-equiv="Content-Security-Policy" content="{csp}">\n'
        '<title>{title}</title><style>{style}</style></head>\n'
        '<body><div id="app"></div>\n'
        '{scripts}</body></html>\n')
PAGES = (  # (output path under the root, lang, title, dev, boot module)
    ('index.html', 'ja', '文字PVメーカー', False, 'ui/boot'),
    ('en/index.html', 'en', 'Moji PV Maker', False, 'ui/boot'),
)
LAB_PAGE = ('tests/www/lab.html', 'ja', '文字PVメーカー lab', True, 'ui/lab')


# --------------------------------------------------------------------------------------------------------------
# Problems

class Problems:
    """Collects `path:line: rule` reports; printed sorted so the output is stable."""

    def __init__(self, base):
        self.base = base
        self.items = set()

    def add(self, path, line, rule):
        try:
            shown = path.resolve().relative_to(self.base).as_posix()
        except ValueError:
            shown = path.as_posix()
        self.items.add((shown, line, rule))

    def report(self, out):
        for path, line, rule in sorted(self.items):
            print(f'{path}:{line}: {rule}', file=out)

    def __bool__(self):
        return bool(self.items)


# --------------------------------------------------------------------------------------------------------------
# JavaScript scanning: comments, string/template/regex contents.

TOKEN = re.compile(r"""\s+|[A-Za-z_$\u0080-￿][\w$\u0080-￿]*|\d[\w.]*|//|/\*|[`'"{}/]|.""", re.S)
REGEX_AFTER_CHARS = set('(,=:[!&|?{};+-*%<>~^}')
REGEX_AFTER_WORDS = {'return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw',
                     'instanceof', 'yield', 'await'}


class Source:
    """A JS file split into views: `code` (comments and literal contents blanked, delimiters kept),
    `code_str` (only comments blanked) and `strings` (literal and template text parts as (offset, text))."""

    def __init__(self, text):
        self.text = text
        self.newlines = [i for i, ch in enumerate(text) if ch == '\n']
        code, code_str, strings = scan_js(text)
        self.code = code
        self.code_str = code_str
        self.strings = strings

    def line(self, offset):
        return bisect_right(self.newlines, offset - 1) + 1

    @functools.cached_property
    def pairs(self):
        return bracket_pairs(self.code)

    @functools.cached_property
    def sites(self):
        return binding_sites(self.code, self.pairs)


def scan_js(src):
    n = len(src)
    code = list(src)
    code_str = list(src)
    strings = []

    def blank(a, b, comments=False):
        for k in range(a, b):
            if src[k] != '\n':
                code[k] = ' '
                if comments:
                    code_str[k] = ' '

    last = ''            # the previous significant token, to tell a regex literal from a division
    tpl_depth = []       # brace depth inside each open ${ … } of a template literal
    i = 0
    while i < n:
        if tpl_depth and tpl_depth[-1] < 0:     # resume the template text after a closing }
            tpl_depth.pop()
            i = scan_template(src, i, strings, blank, tpl_depth)
            last = 'str'
            continue
        m = TOKEN.match(src, i)
        tok = m.group(0)
        end = m.end()
        if tok[0].isspace():
            i = end
            continue
        if tok == '//':
            j = src.find('\n', i)
            j = n if j < 0 else j
            blank(i, j, comments=True)
            i = j
            continue
        if tok == '/*':
            j = src.find('*/', i + 2)
            j = n if j < 0 else j + 2
            blank(i, j, comments=True)
            i = j
            continue
        if tok in ('"', "'"):
            j = i + 1
            while j < n and src[j] != tok and src[j] != '\n':
                j += 2 if src[j] == '\\' else 1
            j = min(j, n)
            strings.append((i + 1, src[i + 1:j]))
            blank(i + 1, j)
            i = j + 1
            last = 'str'
            continue
        if tok == '`':
            i = scan_template(src, i + 1, strings, blank, tpl_depth)
            last = 'str'
            continue
        if tok == '/' and (last == '' or last in REGEX_AFTER_CHARS or last in REGEX_AFTER_WORDS):
            body_end = regex_end(src, i)
            if body_end is not None:
                blank(i + 1, body_end)
                i = body_end + 1
                while i < n and (src[i].isalnum() or src[i] in '_$'):
                    i += 1
                last = 'str'
                continue
        if tok == '{' and tpl_depth:
            tpl_depth[-1] += 1
        elif tok == '}' and tpl_depth:
            tpl_depth[-1] -= 1
            if tpl_depth[-1] < 0:
                i = end
                continue
        last = tok if (tok[0].isalpha() or tok[0] in '_$') else ('num' if tok[0].isdigit() else tok)
        i = end
    return ''.join(code), ''.join(code_str), strings


def scan_template(src, i, strings, blank, tpl_depth):
    """Scans template text from i up to the closing backtick or the next ${; returns the index after it."""
    n = len(src)
    j = i
    while j < n:
        ch = src[j]
        if ch == '\\':
            j += 2
            continue
        if ch == '`':
            strings.append((i, src[i:j]))
            blank(i, j)
            return j + 1
        if ch == '$' and j + 1 < n and src[j + 1] == '{':
            strings.append((i, src[i:j]))
            blank(i, j)
            tpl_depth.append(0)
            return j + 2
        j += 1
    strings.append((i, src[i:n]))
    blank(i, n)
    return n


def regex_end(src, i):
    """Index of the closing '/' of a regex literal starting at i, or None when it is not one."""
    n = len(src)
    j = i + 1
    in_class = False
    while j < n:
        ch = src[j]
        if ch == '\\':
            j += 2
            continue
        if ch == '\n':
            return None
        if in_class:
            if ch == ']':
                in_class = False
        elif ch == '[':
            in_class = True
        elif ch == '/':
            return j if j > i + 1 else None
        j += 1
    return None


def matching_close(code, open_at):
    """Index of the bracket closing the one at open_at (any of ([{), in a comment/literal-free view."""
    pairs = {'(': ')', '[': ']', '{': '}'}
    depth = 0
    for k in range(open_at, len(code)):
        ch = code[k]
        if ch in pairs:
            depth += 1
        elif ch in ')]}':
            depth -= 1
            if depth == 0:
                return k
    return -1


# --------------------------------------------------------------------------------------------------------------
# Modules and layers (§2.2, §2.3)

DEF_HEAD = re.compile(r"""MV\.def\(\s*'([^']+)'\s*,\s*\[([^\]]*)\]""")
DEP_ITEM = re.compile(r"""^(?:'([^'\\]*)'|"([^"\\]*)")$""")
FACTORY = re.compile(r"""\s*,\s*(?:\(([^()]*)\)|([A-Za-z_$][\w$]*))\s*=>\s*|\s*,\s*function\b[^(]*\(([^()]*)\)\s*""")
MODULE_ID = re.compile(r'^[a-z0-9_]+(/[a-z0-9_]+)*$')


class Module:
    def __init__(self, mid, path, text, deps, src, def_at, factory_params, body_at):
        self.id = mid
        self.path = path
        self.text = text
        self.deps = deps
        self.src = src
        self.def_at = def_at
        self.factory_params = factory_params
        self.body_at = body_at          # index of the factory body '{', or -1 for an expression body
        self.layer = layer_of(mid)


def layer_of(mid):
    if mid.startswith('core/'):
        return 0
    if mid.startswith(('audio/host/', 'media/host/')):
        return 6
    if mid.startswith(('i18n/', 'engine/text/', 'audio/', 'media/')):
        return 1
    if mid.startswith('planner/'):
        return 2
    if mid.startswith(('engine/scene/', 'engine/render/')) or mid in ('parts/kit', 'parts/mix'):
        return 3
    if mid == 'parts/catalog' or re.match(r'^parts/(%s)/' % '|'.join(PART_KINDS), mid):
        return 4
    if mid.startswith(('engine/host/', 'export/host/')):
        return 6
    if mid == 'engine/facade' or mid.startswith(('export/', 'ai/')):
        return 5
    if mid.startswith('ui/'):
        return 7
    return None


def l1_group(mid):
    for g in ('i18n/', 'engine/text/', 'audio/', 'media/'):
        if mid.startswith(g):
            return g
    return None


def is_part_file(mid):
    return layer_of(mid) == 4 and mid != 'parts/catalog'


# The metric-free engine/text modules the planner may use (§2.3): the breaker, the vertical classes, and the face
# resolution of §4.16.3 (engine/text/faces.resolveFaces: pure data, no measuring, no fonts loaded).
PLANNER_TEXT = ('engine/text/breaker', 'engine/text/vert', 'engine/text/faces')


def dependency_allowed(mid, dep):
    """(ok, reason) for `mid` depending on `dep` under the layer table of §2.3."""
    ls, ld = layer_of(mid), layer_of(dep)
    if dep.startswith('ui/') and ls != 7:
        return False, 'only ui/* may depend on ui/*'
    if dep.startswith('media/') and mid.startswith('engine/'):
        return False, 'the engine never depends on media/* (its media math is core/media)'
    if ls == 0:
        return ld == 0, 'L0 may depend only on L0'
    if ls == 1:
        ok = ld == 0 or (ld == 1 and l1_group(mid) == l1_group(dep))
        return ok, 'L1 may depend on L0 and its own directory'
    if ls == 2:
        if dep.startswith('engine/text/'):
            return dep in PLANNER_TEXT, 'planner may use only engine/text/breaker, vert and faces'
        return ld in (0, 1, 2), 'L2 may depend on L0–L2'
    if ls == 3:
        return ld in (0, 1, 3), 'L3 may depend on L0, L1 and L3 (no planner functions)'
    if mid == 'parts/catalog':
        return dep == 'core/registry', 'parts/catalog may depend only on core/registry'
    if ls == 4:
        return dep == 'parts/kit', 'part files may depend only on parts/kit'
    if ls == 5:
        return ld <= 5, 'L5 may depend on L0–L5 (host services are injected)'
    if ls == 6:
        return ld <= 6, 'L6 may not depend on ui/*'
    return True, ''


# --------------------------------------------------------------------------------------------------------------
# Token context and local bindings (all on the `code` view, where comments and literal contents are blanked)

IDENT = re.compile(r'(?<![\w$])[A-Za-z_$][\w$]*')
DECLARATION = re.compile(r'(?<![\w$.#])(?:const|let|var)(?![\w$])')
CALLABLE_HEAD = re.compile(r'(?<![\w$.#])([A-Za-z_$][\w$]*)\s*\(')      # `name(`: function, method, catch or a call
ARROW_PARAMS = re.compile(r'\)\s*=>')
ARROW_PARAM = re.compile(r'(?<![\w$.#])([A-Za-z_$][\w$]*)\s*=>')
NOT_PARAMS = {'if', 'for', 'while', 'switch', 'with'}
ACCESS = re.compile(r'\s*(?:\?\.|[.\[(`])')                             # a member access, index, call or tag
PATTERN_TOKEN = re.compile(r'\.\.\.|[A-Za-z_$][\w$]*|=>|[=!<>]=+|[(){}\[\],:=.]|\S')


def prev_sig(code, pos):
    """Index of the last non-space character before pos, or -1."""
    k = pos - 1
    while k >= 0 and code[k].isspace():
        k -= 1
    return k


def next_sig(code, pos):
    """Index of the first non-space character at or after pos (len(code) when there is none)."""
    k = pos
    while k < len(code) and code[k].isspace():
        k += 1
    return k


def is_property_name(code, pos):
    """True for `x.name` and `x?.name`; a spread `...name` is a value."""
    k = prev_sig(code, pos)
    return k >= 0 and code[k] == '.' and not (k >= 2 and code[k - 2:k] == '..')


def is_object_key(code, start, end):
    """True for `{ name: …` and `, name: …`; the middle operand of `c ? name : d` is a value."""
    k, j = prev_sig(code, start), next_sig(code, end)
    return k >= 0 and code[k] in '{,' and j < len(code) and code[j] == ':'


def uses(code, name):
    """(start, end) of each value use of the identifier `name`: not a property name and not an object key."""
    for m in re.finditer(r'(?<![\w$#])' + re.escape(name) + r'(?![\w$])', code):
        if not is_property_name(code, m.start()) and not is_object_key(code, m.start(), m.end()):
            yield m.start(), m.end()


def bracket_pairs(code):
    """{open index: close index} for (), [] and {}; unbalanced brackets are left out."""
    pairs, stack = {}, []
    for m in re.finditer(r'[()\[\]{}]', code):
        if m.group(0) in '([{':
            stack.append(m.start())
        elif stack:
            pairs[stack.pop()] = m.start()
    return pairs


def expression_end(code, start):
    """Last index of an expression starting at start: it stops before a ',' or ';' or a closing bracket at depth 0."""
    depth = 0
    for k in range(start, len(code)):
        ch = code[k]
        if ch in '([{':
            depth += 1
        elif ch in ')]}':
            if depth == 0:
                return k - 1
            depth -= 1
        elif ch in ',;' and depth == 0:
            return k - 1
    return len(code) - 1


def body_end(code, pairs, pos):
    """Last index of the function or loop body that starts at pos: a `{ … }` block or one expression."""
    k = next_sig(code, pos)
    if k < len(code) and code[k] == '{':
        return pairs.get(k, len(code) - 1)
    return expression_end(code, k)


def bound_names(pattern):
    """Names bound by a parameter list or a destructuring pattern. Object keys, default values and computed keys
    bind nothing: in `{ a: b = c, [d]: e }` only b and e are bound."""
    tokens = PATTERN_TOKEN.findall(pattern)
    names, stack = set(), []           # stack: '{' / '[' patterns, '=' a default value, 'x' any other expression
    for i, tok in enumerate(tokens):
        prev = tokens[i - 1] if i else ''
        nxt = tokens[i + 1] if i + 1 < len(tokens) else ''
        if tok in ('(', '[', '{'):
            computed_key = tok == '[' and stack[-1:] == ['{'] and prev in ('{', ',')
            stack.append('x' if tok == '(' or computed_key else tok)
        elif tok in (')', ']', '}'):
            if stack[-1:] == ['=']:
                stack.pop()
            if stack:
                stack.pop()
        elif tok == ',':
            if stack[-1:] == ['=']:
                stack.pop()
        elif tok == '=':
            stack.append('=')
        elif IDENT.fullmatch(tok) and prev != '.' and nxt != ':' and '=' not in stack and 'x' not in stack:
            names.add(tok)
    return names


def declared_names(code, pairs, pos):
    """Names declared by the `const`/`let`/`var` declarator list that starts at pos."""
    names = set()
    k = pos
    while True:
        k = next_sig(code, k)
        if k < len(code) and code[k] in '{[':
            close = pairs.get(k, len(code) - 1)
            names |= bound_names(code[k + 1:close])
            k = close + 1
        else:
            m = IDENT.match(code, k)
            if not m:
                return names
            names.add(m.group(0))
            k = m.end()
        k = expression_end(code, k) + 1           # skip the initializer (or `of xs` in a loop head)
        if k >= len(code) or code[k] != ',':
            return names
        k += 1


def innermost_opens(code, positions):
    """{pos: index of the innermost bracket around pos, or -1}, for many positions in one pass."""
    marks = sorted(set(positions))
    out, stack, i = {}, [], 0
    for m in re.finditer(r'[()\[\]{}]', code):
        while i < len(marks) and marks[i] < m.start():
            out[marks[i]] = stack[-1] if stack else -1
            i += 1
        if m.group(0) in '([{':
            stack.append(m.start())
        elif stack:
            stack.pop()
    for pos in marks[i:]:
        out[pos] = stack[-1] if stack else -1
    return out


def declaration_scope(code, pairs, around):
    """The block `around` a declaration; for a loop head `for (const x of xs) body`, the head and the body."""
    if around < 0 or around not in pairs:
        return 0, len(code) - 1
    if code[around] == '(':
        return around, body_end(code, pairs, pairs[around] + 1)
    return around, pairs[around]


def binding_sites(code, pairs):
    """Every local binding in a file as (names, lo, hi): the names and the range of `code` where they are in scope.
    `var` is treated as block-scoped, which is stricter than JS."""
    declarations = [(m.start(), declared_names(code, pairs, m.end())) for m in DECLARATION.finditer(code)]
    around = innermost_opens(code, [at for at, _ in declarations])
    sites = [(names, *declaration_scope(code, pairs, around[at])) for at, names in declarations if names]
    opens = {c: o for o, c in pairs.items()}
    for m in ARROW_PARAMS.finditer(code):
        o = opens.get(m.start())
        if o is not None:
            sites.append((bound_names(code[o + 1:m.start()]), o, body_end(code, pairs, m.end())))
    for m in ARROW_PARAM.finditer(code):
        sites.append(({m.group(1)}, m.start(), body_end(code, pairs, m.end())))
    for m in CALLABLE_HEAD.finditer(code):          # function, method or catch parameters: `(…)` followed by a block
        o = m.end() - 1
        c = pairs.get(o)
        if m.group(1) in NOT_PARAMS or c is None:
            continue
        b = next_sig(code, c + 1)
        if b < len(code) and code[b] == '{':
            sites.append((bound_names(code[o + 1:c]), o, pairs.get(b, len(code) - 1)))
    return sites


def global_uses(src, name):
    """Offsets where `name` means the browser global: each value use outside every local binding of the name, and
    every member access, index or call on it even inside one (a local that reuses a browser-global name, such as the
    FROZEN `window` option of fitMotion, is never an object or a function)."""
    code = src.code
    return [a for a, b in uses(code, name)
            if ACCESS.match(code, b) or not any(name in names and lo <= a <= hi for names, lo, hi in src.sites)]


# --------------------------------------------------------------------------------------------------------------
# Lint rules (§2.4)

# (rule, pattern, bare): with bare=True a match that is a property name (`rows.with(…)`, `o.import(…)`) is allowed.
EVERYWHERE = [
    ('eval(', re.compile(r'(?<![\w$#])eval\s*\('), True),
    ('new Function', re.compile(r'\bnew\s+Function\b'), False),
    ('import(', re.compile(r'(?<![\w$#])import\s*\('), True),
    ('^import ', re.compile(r'(?m)^[ \t]*import\s'), False),
    ('^export ', re.compile(r'(?m)^[ \t]*export\s'), False),
    ('require(', re.compile(r'(?<![\w$#])require\s*\('), True),
    ('.innerHTML', re.compile(r'\.\s*innerHTML\b'), False),
    ('.outerHTML', re.compile(r'\.\s*outerHTML\b'), False),
    ('insertAdjacentHTML', re.compile(r'\binsertAdjacentHTML\b'), False),
    ('document.write', re.compile(r'\bdocument\s*\.\s*write'), False),
    ('with (', re.compile(r'(?<![\w$#])with\s*\('), True),
]
STYLE_ATTR = re.compile(r"""setAttribute\(\s*['"]style['"]""")
HTML_HANDLER = re.compile(r'\son[a-z]+\s*=')
MATH_RANDOM = ('Math.random', re.compile(r'\bMath\s*\.\s*random\b'), False)
PURE_PATTERNS = [
    MATH_RANDOM,
    ('performance.now', re.compile(r'\bperformance\s*\.\s*now\b'), False),
    ('Intl.Segmenter', re.compile(r'\bIntl\s*\.\s*Segmenter\b'), False),
    ('fetch(', re.compile(r'(?<![\w$#])fetch\s*\('), True),
]
# Banned as values anywhere in L0–L5 (§7.1): `Date` covers Date(), new Date, Date.now and passing Date around.
PURE_NAMES = ('Date', 'setTimeout', 'setInterval', 'requestAnimationFrame')
BROWSER_GLOBALS = ('document', 'window', 'navigator', 'localStorage', 'sessionStorage', 'indexedDB')
AI_GLOBALS = ('document', 'window', 'localStorage', 'sessionStorage', 'indexedDB')
PIXEL_READS = ('getImageData / putImageData', re.compile(r'\b(?:get|put)ImageData\b'), False)
FILTER_ASSIGN = ('ctx.filter assignment', re.compile(r'\.\s*filter\s*=(?![=>])'), False)
FN_KEY = re.compile(r'(?<![\w$.#])fn(?![\w$])')
INLINE_FUNCTION = re.compile(r'function\s*\*?\s*(?:[A-Za-z_$][\w$]*)?\s*\(')
FN_AUTO_ALLOWED = {
    'Math', 'Number', 'String', 'Boolean', 'Array', 'Object', 'JSON', 'Infinity', 'NaN', 'undefined', 'isFinite',
    'isNaN', 'parseFloat', 'parseInt', 'true', 'false', 'null', 'return', 'const', 'let', 'var', 'if', 'else', 'for',
    'of', 'in', 'while', 'do', 'break', 'continue', 'new', 'typeof', 'instanceof', 'void', 'switch', 'case', 'default',
    'function',
}


def lint(mod, problems):
    src, path = mod.src, mod.path
    layer = mod.layer

    def each(rule, pattern, bare, view=None):
        text = src.code if view is None else view
        for m in pattern.finditer(text):
            if not (bare and is_property_name(text, m.start())):
                problems.add(path, src.line(m.start()), 'lint ' + rule)

    def banned_names(label, banned, scoped):
        for name in banned:
            starts = global_uses(src, name) if scoped else [a for a, _ in uses(src.code, name)]
            for a in starts:
                problems.add(path, src.line(a), 'lint %s (%s)' % (name, label))

    for rule, pattern, bare in EVERYWHERE:
        each(rule, pattern, bare)
    each("setAttribute('style'", STYLE_ATTR, False, src.code_str)
    for offset, text in src.strings:
        if '<' in text:
            for m in HTML_HANDLER.finditer(text):
                problems.add(path, src.line(offset + m.start()), 'lint on…= handler inside an HTML string')

    is_ai = mod.id.startswith('ai/')
    if layer is not None and layer <= 5 and not is_ai:
        for rule, pattern, bare in PURE_PATTERNS:
            each(rule + ' (L0–L5)', pattern, bare)
        banned_names('L0–L5', PURE_NAMES, scoped=False)
        banned_names('L0–L5', BROWSER_GLOBALS, scoped=True)
    if is_ai:
        each('Math.random (ai)', MATH_RANDOM[1], False)
        banned_names('ai', AI_GLOBALS, scoped=True)
    if mod.id.startswith('engine/render/') or is_part_file(mod.id):
        each(*PIXEL_READS)
    if is_part_file(mod.id):
        each(*FILTER_ASSIGN)
        lint_factory_state(mod, problems)
        lint_fn_autos(mod, problems)


def lint_factory_state(mod, problems):
    """`let`/`var` directly in a part factory body is module-level mutable state."""
    if mod.body_at < 0:
        return
    code = mod.src.code
    close = matching_close(code, mod.body_at)
    depth = 0
    for m in re.finditer(r'[()\[\]{}]|\b(?:let|var)\b', code[mod.body_at:close + 1]):
        tok = m.group(0)
        if tok in '([{':
            depth += 1
        elif tok in ')]}':
            depth -= 1
        elif depth == 1:
            problems.add(mod.path, mod.src.line(mod.body_at + m.start()), 'lint module-level mutable state (' + tok + ')')


def function_autos(code, pairs):
    """Each `fn` property of an object literal as (at, span): span is (params open, params close, body end) of the
    inline function literal (`fn: (…) => …`, `fn: x => …`, `fn: function (…) {…}`, `fn(…) {…}`), or None when
    the value is anything else (`fn: helper`, `{ fn }`, `fn: make()`, `fn: K.x`)."""
    for m in FN_KEY.finditer(code):
        at = m.start()
        k, j = prev_sig(code, at), next_sig(code, m.end())
        if k < 0 or code[k] not in '{,' or j >= len(code):
            continue                                     # not a property of an object literal
        if code[j] == ':':
            yield at, inline_function(code, pairs, next_sig(code, j + 1))
        elif code[j] == '(':                             # method shorthand `fn(f) { … }` (a call has no block)
            c = pairs.get(j)
            b = next_sig(code, c + 1) if c is not None else len(code)
            if b < len(code) and code[b] == '{':
                yield at, (j, c, pairs.get(b, len(code) - 1))
        elif code[j] in ',}':                            # shorthand `{ fn }`: a function defined elsewhere
            around = innermost_opens(code, [at])[at]
            if around >= 0 and code[around] == '{':
                yield at, None


def inline_function(code, pairs, v):
    """(params open, params close, body end) of the function literal at v, or None."""
    fm = INLINE_FUNCTION.match(code, v)
    if fm:
        o = fm.end() - 1
        c = pairs.get(o)
        return (o, c, body_end(code, pairs, c + 1)) if c is not None else None
    if v < len(code) and code[v] == '(':
        c = pairs.get(v)
        arrow = ARROW_PARAMS.match(code, c) if c is not None else None
        return (v, c, body_end(code, pairs, arrow.end())) if arrow else None
    am = ARROW_PARAM.match(code, v)
    if am:
        return v - 1, am.end(1), body_end(code, pairs, am.end())
    return None


def lint_fn_autos(mod, problems):
    """A function auto may use only its own parameters and locals, the factory's kit parameter and pure JS built-ins
    (§2.4); default values are checked like the body."""
    src = mod.src
    code = src.code
    kit = set(IDENT.findall(mod.factory_params))
    for at, span in function_autos(code, src.pairs):
        if span is None:
            problems.add(mod.path, src.line(at), 'lint fn auto must be an inline function literal')
            continue
        o, c, end = span
        allowed = FN_AUTO_ALLOWED | kit | bound_names(code[o + 1:c])
        for names, lo, _ in src.sites:
            if o < lo <= end:
                allowed |= names
        for im in IDENT.finditer(code, o + 1, end + 1):
            name = im.group(0)
            if name in allowed or is_property_name(code, im.start()) or is_object_key(code, im.start(), im.end()):
                continue
            problems.add(mod.path, src.line(im.start()), 'lint fn auto uses ' + name)


# --------------------------------------------------------------------------------------------------------------
# Reading the tree

def read_text(path, problems):
    """The file as UTF-8 with every line break as '\\n' (None when it is not UTF-8). The HTML parser turns CRLF and a
    lone CR into LF before the browser hashes an inline element for the CSP check, so the build hashes and emits
    the text the way the browser will see it (§2.6 steps 5 and 6). JS and CSS read CR, LF and CRLF alike."""
    try:
        text = path.read_bytes().decode('utf-8')
    except UnicodeDecodeError as err:
        problems.add(path, 1, 'encoding: not UTF-8 (byte %d)' % err.start)
        return None
    return text.replace('\r\n', '\n').replace('\r', '\n')


def read_module(path, src_dir, problems):
    text = read_text(path, problems)
    if text is None:
        return None
    rel = path.relative_to(src_dir).as_posix()
    mid = rel[:-3]
    if not text.startswith(HEADER) or text.find('*/') < 0:
        problems.add(path, 1, 'header: must start with ' + HEADER + ' … */')
    if not MODULE_ID.match(mid):
        problems.add(path, 1, 'module id: path must be lowercase [a-z0-9_] segments')
    src = Source(text)
    defs = list(re.finditer(r'\bMV\s*\.\s*def\s*\(', src.code))
    if len(defs) != 1:
        problems.add(path, 1, 'one-def: exactly one MV.def( per file (found %d)' % len(defs))
        if not defs:
            return None
    lead = re.match(r'\s*', src.code).end()
    def_at = defs[0].start()
    if def_at != lead:
        problems.add(path, src.line(lead), 'outside-def: nothing may precede MV.def( except the header comment')
    head = DEF_HEAD.match(text, def_at)
    if not head:
        problems.add(path, src.line(def_at), "def-header: expected MV.def('<id>', [<string literals>], factory)")
        return None
    if head.group(1) != mid:
        problems.add(path, src.line(def_at), "def-id: '%s' does not match its path '%s'" % (head.group(1), mid))
    deps = []
    for item in head.group(2).split(','):
        item = item.strip()
        if not item:
            continue
        dm = DEP_ITEM.match(item)
        if not dm:
            problems.add(path, src.line(def_at), 'deps: dependencies must be string literals')
            continue
        deps.append(dm.group(1) if dm.group(1) is not None else dm.group(2))
    if len(set(deps)) != len(deps):
        problems.add(path, src.line(def_at), 'deps: duplicate dependency')
    paren = src.code.index('(', def_at)
    close = matching_close(src.code, paren)
    if close < 0:
        problems.add(path, src.line(def_at), 'def-header: MV.def( is never closed')
        return None
    if not re.fullmatch(r'\s*;?\s*', src.code[close + 1:]):
        problems.add(path, src.line(close + 1), 'outside-def: nothing may follow the MV.def(…) call')
    factory_params, body_at = '', -1
    fm = FACTORY.match(src.code, head.end())
    if fm:
        factory_params = next((g for g in fm.groups() if g is not None), '')
        if fm.end() < len(src.code) and src.code[fm.end()] == '{':
            body_at = fm.end()
    else:
        problems.add(path, src.line(head.end()), 'def-header: the factory must follow the dependency list')
    return Module(head.group(1), path, text, deps, src, def_at, factory_params, body_at)


def collect(root, problems):
    src_dir = root / 'src'
    kernel_path = src_dir / 'core' / 'define.js'
    kernel = None
    if not kernel_path.is_file():
        problems.add(kernel_path, 1, 'kernel: src/core/define.js is missing')
    else:
        kernel = read_text(kernel_path, problems)
    if kernel is not None:
        if not kernel.startswith(HEADER):
            problems.add(kernel_path, 1, 'header: must start with ' + HEADER + ' … */')
        lint(Module('core/define', kernel_path, kernel, [], Source(kernel), 0, '', -1), problems)
    modules = {}
    for path in sorted(src_dir.rglob('*.js'), key=lambda p: p.as_posix()):
        if path == kernel_path:
            continue
        mod = read_module(path, src_dir, problems)
        if mod is None:
            continue
        if mod.layer is None:
            problems.add(path, 1, 'layer: no layer for module ' + mod.id)
            continue
        if mod.id in modules:
            problems.add(path, 1, 'def-id: duplicate module ' + mod.id)
            continue
        modules[mod.id] = mod
    css_path = src_dir / 'ui' / 'style.css'
    css = (read_text(css_path, problems) if css_path.is_file() else '') or ''
    if css and not css.startswith(HEADER):
        problems.add(css_path, 1, 'header: must start with ' + HEADER + ' … */')
    what = inline_hazard(STYLE_HAZARD, css)
    if what:
        problems.add(css_path, 1, 'inline: style.css may not contain ' + what)
    return kernel, modules, css


def check_layers(modules, problems):
    for mod in modules.values():
        for dep in mod.deps:
            line = mod.src.line(mod.def_at)
            if dep not in modules:
                problems.add(mod.path, line, 'missing-dep: ' + dep)
                continue
            ok, why = dependency_allowed(mod.id, dep)
            if not ok:
                problems.add(mod.path, line, 'layer: %s → %s (%s)' % (mod.id, dep, why))


def topo_sort(modules, problems):
    """Kahn's algorithm; ties broken by (layer, id)."""
    indegree = {mid: 0 for mid in modules}
    users = {mid: [] for mid in modules}
    for mod in modules.values():
        for dep in mod.deps:
            if dep in modules:
                indegree[mod.id] += 1
                users[dep].append(mod.id)
    ready = [(modules[m].layer, m) for m, d in indegree.items() if d == 0]
    heapq.heapify(ready)
    order = []
    while ready:
        _, mid = heapq.heappop(ready)
        order.append(mid)
        for user in users[mid]:
            indegree[user] -= 1
            if indegree[user] == 0:
                heapq.heappush(ready, (modules[user].layer, user))
    stuck = sorted(m for m, d in indegree.items() if d > 0)
    if stuck:
        cycle = find_cycle(modules, set(stuck))
        mod = modules[cycle[0]]
        problems.add(mod.path, mod.src.line(mod.def_at), 'cycle: ' + ' → '.join(cycle + [cycle[0]]))
    return order


def find_cycle(modules, nodes):
    """One dependency cycle among `nodes` (all of which are stuck in the sort), as a list of module ids."""
    start = min(nodes)
    path, seen = [start], {start: 0}
    while True:
        nxt = sorted(d for d in modules[path[-1]].deps if d in nodes)[0]
        if nxt in seen:
            return path[seen[nxt]:]
        seen[nxt] = len(path)
        path.append(nxt)


# --------------------------------------------------------------------------------------------------------------
# Pages (§2.5, §2.6)

def sha256(text):
    return "'sha256-" + base64.b64encode(hashlib.sha256(text.encode('utf-8')).digest()).decode('ascii') + "'"


def app_script(kernel, modules, order, lang, dev, boot):
    parts = [kernel.rstrip('\n'), "MV.DEV=%s;MV.LANG='%s';" % ('true' if dev else 'false', lang)]
    parts += [modules[mid].text.rstrip('\n') for mid in order]
    parts.append("MV.use('%s').start();" % boot)
    return '\n'.join(parts) + '\n'


def render_page(lang, title, css, vendors, app):
    scripts = list(vendors) + [app]
    csp = CSP.format(scripts=' '.join(sha256(s) for s in scripts), style=sha256(css))
    tags = ''.join('<script>' + s + '</script>' for s in scripts)
    return PAGE.format(lang=lang, csp=csp, title=title, style=css, scripts=tags)


SCRIPT_HAZARD = re.compile(r'</script|<!--|\x00', re.I)
STYLE_HAZARD = re.compile(r'</style|\x00', re.I)


def inline_hazard(pattern, text):
    """What in `text` the HTML parser would not pass through verbatim: an end tag, `<!--` in a script, or a NUL
    (it becomes U+FFFD, so the browser would hash other text than the build did). None when there is nothing."""
    m = pattern.search(text)
    if m is None:
        return None
    return 'a NUL character' if m.group(0) == '\x00' else m.group(0)


def build_pages(root, kernel, modules, order, css, lab, problems):
    vendor_dir = root / 'vendor'
    vendors = []
    for name in VENDOR_FILES:
        path = vendor_dir / name
        if not path.is_file():
            problems.add(path, 1, 'vendor: missing ' + name)
            continue
        text = read_text(path, problems)
        if text is None:
            continue
        what = inline_hazard(SCRIPT_HAZARD, text)
        if what:
            problems.add(path, 1, 'inline: vendor script contains ' + what)
        vendors.append(text)
    pages = list(PAGES) + ([LAB_PAGE] if lab else [])
    outputs = []
    for rel, lang, title, dev, boot in pages:
        if boot not in modules:
            problems.add(root / 'src' / (boot + '.js'), 1, 'boot: module %s is required for %s' % (boot, rel))
            continue
        app = app_script(kernel, modules, order, lang, dev, boot)
        what = inline_hazard(SCRIPT_HAZARD, app)
        if what:
            problems.add(root / 'src', 1, 'inline: app script contains ' + what)
        outputs.append((root / rel, render_page(lang, title, css, vendors, app)))
    return outputs


def main(argv=None):
    ap = argparse.ArgumentParser(description='Build 文字PVメーカー v2 (DESIGN §2.6).')
    ap.add_argument('--check', action='store_true', help='lint + layers + topo only; writes nothing')
    ap.add_argument('--lab', action='store_true', help='also write tests/www/lab.html')
    ap.add_argument('--root', help='the tree to build: DIR/src and DIR/vendor (default: the one containing this script)')
    args = ap.parse_args(argv)
    root = Path(args.root).resolve() if args.root else Path(__file__).resolve().parent
    problems = Problems(root)
    kernel, modules, css = collect(root, problems)
    check_layers(modules, problems)
    for mod in modules.values():
        lint(mod, problems)
    order = topo_sort(modules, problems)
    if problems:
        problems.report(sys.stderr)
        print('build: %d problem(s)' % len(problems.items), file=sys.stderr)
        return 1
    if args.check:
        print('build --check: %d modules OK' % (len(modules) + 1))
        return 0
    outputs = build_pages(root, kernel, modules, order, css, args.lab, problems)
    if problems:
        problems.report(sys.stderr)
        return 1
    for path, html in outputs:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(html.encode('utf-8'))
        print('build: wrote %s (%d bytes)' % (path.relative_to(root).as_posix(), len(html.encode('utf-8'))))
    return 0


if __name__ == '__main__':
    sys.exit(main())
