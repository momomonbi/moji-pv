"""Build the Japanese and English single-file browser editions from src/, app/ and vendor/.
usage: python3 build.py            -> index.html and en/index.html (GitHub Pages)
       python3 build.py --dev      -> also dev/www/jizura.js + dev/www/test.html for the test tools"""
import base64, glob, hashlib, os, sys
from app.english import localize_body, localize_js
ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)
read = lambda p: open(p, encoding='utf-8').read()

# アプリ名と公開先（仮の名前。変えるときはここだけ直して再ビルドする）
SITE = 'https://momomonbi.github.io/moji-pv/'
APP = {
    'ja': {'title': '文字PVメーカー', 'word': 'MOJI PV MAKER',
           'description': '歌詞と曲から文字PV（リリックモーション）を作って MP4 に書き出すブラウザアプリ'},
    'en': {'title': 'Moji PV Maker — Lyric Motion Video Maker', 'word': 'MOJI PV MAKER',
           'description': 'Turn lyrics into animated lyric videos in your browser and export MP4.'},
}

# Content-Security-Policy (<meta>). Inline scripts are allowed only by their SHA-256 hash, so any script that is
# injected later (or edited by hand in index.html without rebuilding) is blocked. Styles stay 'unsafe-inline'
# because the UI sets style attributes. Only Google Fonts and the AI APIs the user picks can be reached.
AI_ORIGINS = ['https://generativelanguage.googleapis.com', 'https://api.anthropic.com']
def csp(scripts):
    hashes = ' '.join("'sha256-" + base64.b64encode(hashlib.sha256(s.encode('utf-8')).digest()).decode() + "'" for s in scripts)
    return '; '.join([
        "default-src 'none'",
        'script-src ' + hashes,
        "style-src 'unsafe-inline' https://fonts.googleapis.com",
        'font-src https://fonts.gstatic.com',
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        'connect-src ' + ' '.join(AI_ORIGINS),
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
    ])

sources = sorted(glob.glob('src/*.js'))
js = '\n'.join(read(f) for f in sources)
mux = '/*! mp4-muxer v5.2.2 | MIT License | (c) 2023 Vanilagy | see THIRD_PARTY_NOTICES.md */\n' + read('vendor/mp4-muxer.min.js')
claude_sdk = read('vendor/ai-sdk.min.js')     # built by tools/vendor (npm run build); used only when the second AI service is chosen
def fill(text, app):
    return text.replace('{{APP_WORD}}', app['word'])
def build(lang):
    english = lang == 'en'
    app = APP[lang]
    title, description = app['title'], app['description']
    canonical = SITE + 'en/' if english else SITE
    language_nav = ('<nav class="lang-switch" aria-label="Language"><a href="../index.html" lang="ja">日本語</a><span aria-current="page">English</span></nav>' if english else '<nav class="lang-switch" aria-label="言語"><span aria-current="page">日本語</span><a href="en/index.html" lang="en">English</a></nav>')
    body = read('app/body.html').replace('    <div class="acts">', '    ' + language_nav + '\n    <div class="acts">', 1)
    if english: body = localize_body(body)
    body = fill(body, app)
    script = '\n'.join(localize_js(read(f), f) for f in sources) if english else js
    if english:
        marker = '/* ============================================================\n   JIZURA — editor UI'
        if marker not in script: raise ValueError('Could not find browser UI entry point')
        script = script.replace(marker, read('app/english.js') + '\n' + marker, 1)
    mux_js, sdk_js, app_js = '\n' + mux + '\n', '\n' + claude_sdk + '\n', '\n' + script + '\n'
    html = f'''<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="{csp([mux_js, sdk_js, app_js])}">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{description}">
<link rel="canonical" href="{canonical}">
<link rel="alternate" hreflang="ja" href="{SITE}">
<link rel="alternate" hreflang="en" href="{SITE}en/">
<meta property="og:type" content="website">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{description}">
<meta property="og:url" content="{canonical}">
<meta name="twitter:card" content="summary">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<style>
{read('app/style.css')}
</style>
</head>
<body>
{body}
<script>{mux_js}</script>
<script>{sdk_js}</script>
<script>{app_js}</script>
</body>
</html>
'''
    target = 'en/index.html' if english else 'index.html'
    os.makedirs(os.path.dirname(target) or '.', exist_ok=True)
    open(target, 'w', encoding='utf-8').write(html)
    print(target, len(html), 'bytes')
build('ja')
build('en')
if '--dev' in sys.argv:
    os.makedirs('dev/www', exist_ok=True)
    open('dev/www/jizura.js', 'w', encoding='utf-8').write(js)
    open('dev/www/test.html', 'w', encoding='utf-8').write(read('dev/test.html'))
    print('dev/www ready: cd dev/www && python3 -m http.server 8765')
