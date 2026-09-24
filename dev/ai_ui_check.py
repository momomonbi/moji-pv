"""Drive the AI panel end to end in the built page, with the AI service faked (no key, no network, no cost):
Gemini's generateContent is answered by Playwright with canned JSON, so the whole path runs —
settings, request, validation, change lists, apply, undo — under the page's real CSP.
usage: python3 build.py && python3 dev/ai_ui_check.py [index.html|en/index.html] [--shots DIR]   (exit 1 on failure)"""
import asyncio, functools, http.server, io, json, math, os, struct, sys, threading, wave
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from browser import launch, new_page

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = [a for a in sys.argv[1:] if a.endswith('.html')] or ['index.html', 'en/index.html']
SHOTS = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else None

LYRICS = '作詞：だれか\n[Verse]\n花火の夜に約束した\n君の浴衣が揺れていた\n夏休みが終わらないように\n花火の夜に約束した'
PREP = {'summary': 'クレジットとラベルを除きます', 'lines': [
    {'i': 0, 'remove': True, 'reason': 'クレジット', 'segments': [], 'emphasis': [], 'reading': ''},
    {'i': 1, 'remove': True, 'reason': 'セクション名', 'segments': [], 'emphasis': [], 'reading': ''},
    {'i': 2, 'remove': False, 'reason': '', 'segments': ['花火の夜に', '約束した'], 'emphasis': ['花火'], 'reading': ''},
    {'i': 4, 'remove': False, 'reason': '', 'segments': [], 'emphasis': ['夏休み'], 'reading': ''}]}
FX = lambda m, g: {'motion': m, 'glitch': g, 'chroma': 0.4, 'decor': 0.6, 'density': 0.5, 'texture': 0.5, 'bgSwitch': 0.3}
PROPOSALS = {'theme': '夏祭りの夜の約束', 'season': 'summer', 'proposals': [
    {'title': '夜空の花火', 'concept': '暗い空に光る文字', 'style': 'noir', 'mood': 'emotional', 'fx': FX(0.6, 0.1), 'flash': True,
     'palette': {'accent': '#FFB000', 'ghostA': '#00C2B8', 'ghostB': '#FF3D6E'}, 'avoid': ['decor.snow'], 'lines': [{'i': 2, 'layout': 'huge', 'enter': 'zoom', 'exit': 'explode'}]},
    {'title': '浴衣の手帖', 'concept': '紙と墨の落ち着いた夏', 'style': 'paper', 'mood': 'calm', 'fx': FX(0.35, 0.05), 'flash': False,
     'palette': {'accent': '', 'ghostA': '', 'ghostB': ''}, 'avoid': [], 'lines': [{'i': 0, 'layout': 'vcols', 'enter': 'blur', 'exit': 'drift'}]},
    {'title': 'ポップな縁日', 'concept': '明るい色で跳ねる', 'style': 'magenta', 'mood': 'pop', 'fx': FX(0.9, 0.2), 'flash': True,
     'palette': {'accent': '', 'ghostA': '', 'ghostB': ''}, 'avoid': [], 'lines': []}]}
EDIT = {'understood': True, 'summary': 'サビの行を派手にします', 'question': '', 'changes': {
    'style': '', 'mood': '', 'season': '', 'fx': {'motion': 0.95, 'glitch': -1, 'chroma': -1, 'decor': -1, 'density': -1, 'texture': -1, 'bgSwitch': -1},
    'flash': 'keep', 'palette': {'accent': '', 'ghostA': '', 'ghostB': ''}, 'avoid': [], 'allow': [],
    'lines': [{'i': 3, 'layout': 'huge', 'enter': '', 'exit': '', 'hold': '', 'impact': 'on', 'emphasis': []}]}}


TRANSCRIBE = {'language': 'ja', 'note': '', 'lines': [{'start': '00:00.50', 'text': 'はじまりの歌'}, {'start': '00:02.00', 'text': '光のほうへ'}, {'start': '00:03.50', 'text': 'はじまりの歌'}]}
ALIGN = {'note': '', 'lines': [{'i': 0, 'start': '00:00.60'}, {'i': 1, 'start': '00:01.80'}, {'i': 2, 'start': '00:03.00'}, {'i': 3, 'start': '00:04.00'}]}
ANALYZE = {'summary': '明るいポップ', 'mood': '明るい', 'bpm': 120, 'sections': [{'kind': 'intro', 'start': '00:00.0', 'end': '00:01.5'}, {'kind': 'chorus', 'start': '00:01.5', 'end': '00:05.0'}], 'highlights': [{'time': '00:01.5', 'what': 'サビ'}]}


def tone_wav(seconds=5, rate=22050):
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b''.join(struct.pack('<h', int(8000 * math.sin(2 * math.pi * 440 * i / rate))) for i in range(seconds * rate)))
    return buf.getvalue()


def answer_for(body):
    props = json.dumps(body['generationConfig']['responseJsonSchema'])
    data = (PREP if '"reading"' in props else PROPOSALS if '"proposals"' in props else ANALYZE if '"sections"' in props
            else TRANSCRIBE if '"language"' in props else ALIGN if '"start"' in props else EDIT)
    return {'candidates': [{'finishReason': 'STOP', 'content': {'role': 'model', 'parts': [{'text': json.dumps(data, ensure_ascii=False)}]}}],
            'usageMetadata': {'promptTokenCount': 4200, 'candidatesTokenCount': 600, 'thoughtsTokenCount': 300}}


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


async def shot(pg, name):
    if not SHOTS: return
    try: await pg.screenshot(path=f'{SHOTS}/{name}.png', timeout=15000)
    except Exception as e: print('  (screenshot skipped:', str(e).split('\n')[0][:80] + ')')


async def check(b, base, page):
    pg = await new_page(b, viewport={'width': 1440, 'height': 900})
    errs, seen, dialogs, seen_checks = [], [], [], []
    stale = {'on': False}
    pg.on('pageerror', lambda e: errs.append(str(e)[:300]))
    async def on_dialog(d):
        dialogs.append(d.message); await d.accept()
    pg.on('dialog', lambda d: asyncio.ensure_future(on_dialog(d)))
    await pg.add_init_script("window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.effectiveDirective+' '+e.blockedURI))")
    CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,x-goog-api-key', 'access-control-allow-methods': 'GET,POST'}

    async def fake(route):
        req = route.request
        if req.method == 'OPTIONS':
            return await route.fulfill(status=200, headers=CORS)
        if req.method == 'GET':   # key check: model info
            ok = req.headers.get('x-goog-api-key') == 'test-key-123'
            seen_checks.append(req.url)
            return await route.fulfill(status=200 if ok else 400, headers=dict(CORS, **{'content-type': 'application/json'}),
                body=json.dumps({'name': 'models/gemini-3.8-flash', 'displayName': 'Gemini 3.8 Flash', 'supportedGenerationMethods': ['generateContent']} if ok else
                                {'error': {'code': 400, 'message': 'API key not valid.', 'status': 'INVALID_ARGUMENT', 'details': [{'reason': 'API_KEY_INVALID'}]}}))
        body = json.loads(req.post_data)
        seen.append({'url': req.url, 'key': req.headers.get('x-goog-api-key'), 'body': body})
        if stale['on']:   # the user edits the lyrics while the answer is on its way
            stale['on'] = False
            await pg.evaluate("() => { const el = document.getElementById('lyrics'); el.value = '新しい一行\\n' + el.value; el.dispatchEvent(new Event('input')); }")
            await pg.wait_for_timeout(400)
        await route.fulfill(status=200, headers=dict(CORS, **{'content-type': 'application/json'}), body=json.dumps(answer_for(body), ensure_ascii=False))
    await pg.route('https://generativelanguage.googleapis.com/**', fake)
    if SHOTS:   # screenshots wait for web fonts; skip them so a slow font server cannot stall the run
        await pg.route(lambda u: 'fonts.googleapis.com' in u or 'fonts.gstatic.com' in u, lambda r: r.abort())
    await pg.goto(f'{base}/{page}', wait_until='domcontentloaded')
    await pg.wait_for_function('() => window.J && J.ui && J.ui.plan')
    await pg.evaluate("t => { const el = document.getElementById('lyrics'); el.value = t; el.dispatchEvent(new Event('input')); }", LYRICS)
    await pg.wait_for_timeout(500)
    ok = True
    def expect(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        if not cond: ok = False

    await pg.click('#modePro')
    await pg.click('#aiOpen')
    expect(await pg.is_visible('#aiPanel'), 'panel opens')
    await pg.click('#aiPrep')
    await pg.wait_for_selector('#aiResult .ai-box.err')
    expect('API' in (await pg.inner_text('#aiResult')), 'no key -> asks for a key, nothing sent')
    expect(not seen, 'no request without a key')
    expect(await pg.evaluate("document.getElementById('aiProvider').value") == 'gemini', 'Gemini is the default service')
    expect(await pg.evaluate("document.getElementById('aiModel').value") == 'gemini-3.8-flash', 'gemini-3.8-flash is the default model')
    await pg.fill('#aiKey', 'wrong-key'); await pg.press('#aiKey', 'Tab')
    await pg.wait_for_selector('#aiKeyStatus.bad')
    expect(True, 'a wrong key is reported right after it is entered: ' + await pg.inner_text('#aiKeyStatus'))
    await pg.fill('#aiKey', 'test-key-123'); await pg.press('#aiKey', 'Tab')
    await pg.wait_for_selector('#aiKeyStatus.ok')
    expect('gemini-3.8-flash' in await pg.inner_text('#aiKeyStatus'), 'a working key is confirmed: ' + await pg.inner_text('#aiKeyStatus'))
    expect(all('test-key' not in u and 'wrong-key' not in u for u in seen_checks) and len(seen_checks) == 2, 'key check sent the key in the header only')

    # 1) 歌詞の下ごしらえ
    await pg.click('#aiPrep')
    await pg.wait_for_selector('#aiResult .ai-box .ai-changes')
    expect(seen and seen[-1]['key'] == 'test-key-123' and 'test-key-123' not in seen[-1]['url'], 'key sent in the header only')
    expect(seen and seen[-1]['url'].endswith('/gemini-3.8-flash:generateContent'), 'request goes to gemini-3.8-flash')
    sent = json.dumps(seen[-1]['body'], ensure_ascii=False)
    expect('花火の夜に約束した' in sent and 'audio' not in sent.lower(), 'lyric text sent, no audio')
    n_items = await pg.eval_on_selector_all('#aiResult .ai-changes li', 'els => els.length')
    expect(n_items == 4, f'prep lists 4 changes ({n_items})')
    await shot(pg, 'ai_prep_' + page.replace('/', '_'))
    await pg.click('#aiResult [data-a=apply]')
    await pg.wait_for_timeout(400)
    lyr = await pg.evaluate('J.ui.project.lyrics')
    expect(lyr.split('\n')[:2] == ['*花火*の夜に/約束した', '君の浴衣が揺れていた'], 'prep applied to the lyric box: ' + lyr.split('\n')[0])
    expect(await pg.evaluate("document.getElementById('lyrics').value") == lyr, 'textarea shows the new lyrics')

    # 2) AI 演出3案
    await pg.click('#aiPropose')
    await pg.wait_for_selector('#aiResult button[data-k="1"]')
    cards = await pg.eval_on_selector_all('#aiResult button[data-k]', 'els => els.length')
    expect(cards == 3, f'three proposal cards ({cards})')
    await shot(pg, 'ai_proposals_' + page.replace('/', '_'))
    await pg.click('#aiResult button[data-k="0"]'); await pg.wait_for_timeout(400)
    s0 = await pg.evaluate('({style: J.ui.project.style, season: J.ui.project.season, snow: J.ui.project.enabled.decor.snow, ov: J.ui.project.overrides[2], off: J.offSeasonMotifs(J.ui.plan, "summer")})')
    expect(s0['season'] == 'summer' and s0['snow'] is False and s0['ov'] and s0['ov'].get('layout') == 'huge', f'proposal 1 applied {s0}')
    expect(s0['off'] == [], 'no off-season motif in the current plan')
    await pg.click('#aiResult button[data-k="1"]'); await pg.wait_for_timeout(400)
    s1 = await pg.evaluate('({style: J.ui.project.style, ov2: J.ui.project.overrides[2] || null, ov0: J.ui.project.overrides[0] || null})')
    expect(s1['style'] == 'paper' and s1['ov2'] is None and s1['ov0'] and s1['ov0'].get('layout') == 'vcols', f'switching to proposal 2 starts from the same base {s1}')

    # 3) ひとこと修正
    await pg.fill('#aiEditText', 'サビをもっと派手に')
    await pg.press('#aiEditText', 'Enter')
    await pg.wait_for_selector('#aiResult [data-a=apply]')
    expect('サビをもっと派手に' in json.dumps(seen[-1]['body'], ensure_ascii=False), 'instruction sent')
    await shot(pg, 'ai_edit_' + page.replace('/', '_'))
    await pg.click('#aiResult [data-a=apply]'); await pg.wait_for_timeout(400)
    s2 = await pg.evaluate('({motion: J.ui.project.fx.motion, line3: J.ui.project.lyrics.split("\\n")[3], ov3: J.ui.project.overrides[3]})')
    expect(s2['motion'] == 0.95 and s2['line3'].endswith('!') and s2['ov3'].get('layout') == 'huge', f'edit applied {s2}')

    # undo all three steps
    for _ in range(4):
        if await pg.is_enabled('#aiUndo'): await pg.click('#aiUndo'); await pg.wait_for_timeout(250)
    back = await pg.evaluate('({lyrics: J.ui.project.lyrics, season: J.ui.project.season || null})')
    expect(back['lyrics'] == LYRICS and back['season'] is None, 'undo restores the lyrics and look from before AI')
    expect(not dialogs, f'undo right after AI changes asks nothing {dialogs}')

    # an answer to lyrics that changed meanwhile is not applied
    stale['on'] = True
    await pg.click('#aiPrep')
    await pg.wait_for_selector('#aiResult .ai-box.err')
    lyr2 = await pg.evaluate('J.ui.project.lyrics')
    expect(lyr2.startswith('新しい一行\n作詞') and not await pg.query_selector('#aiResult [data-a=apply]'), 'stale answer is refused, lyrics untouched')

    # undo after a manual edit asks first
    await pg.click('#aiPrep'); await pg.wait_for_selector('#aiResult [data-a=apply]')
    await pg.click('#aiResult [data-a=apply]'); await pg.wait_for_timeout(300)
    await pg.evaluate("() => { const el = document.getElementById('lyrics'); el.value += '\\n手で足した行'; el.dispatchEvent(new Event('input')); }")
    await pg.wait_for_timeout(500)
    await pg.click('#aiUndo'); await pg.wait_for_timeout(300)
    expect(len(dialogs) == 1, f'undo after a manual edit asks for confirmation ({len(dialogs)})')
    cost = await pg.inner_text('#aiCost')
    expect('4200' in cost, 'token use shown: ' + cost)
    stored = await pg.evaluate("JSON.stringify(J.ui.project).includes('test-key-123') || (localStorage.getItem('mojipv.project.v1')||'').includes('test-key-123')")
    expect(not stored, 'the key is not in the project or its saved copy')
    # 4) 曲を使う (Gemini only, with consent)
    lyr_before = await pg.evaluate('J.ui.project.lyrics')
    expect(await pg.is_disabled('#aiAnalyze'), 'song buttons are off before a song is loaded')
    await pg.set_input_files('#audioFile', files=[{'name': 'tone.wav', 'mimeType': 'audio/wav', 'buffer': tone_wav()}])
    await pg.wait_for_function('() => J.ui.audio && J.ui.audio.buffer')
    await pg.wait_for_timeout(300)
    expect(await pg.is_disabled('#aiAnalyze'), 'song buttons stay off until the user agrees')
    await pg.check('#aiAudioOk'); await pg.wait_for_timeout(100)
    expect(not await pg.is_disabled('#aiAnalyze'), 'agreeing enables them')
    n0 = len(seen)
    await pg.click('#aiAnalyze')
    await pg.wait_for_selector('#aiResult [data-a=propose]')
    parts = seen[-1]['body']['contents'][0]['parts'] if len(seen) > n0 else []
    audio = parts[0].get('inlineData', {}) if parts else {}
    expect(audio.get('mimeType') == 'audio/wav' and len(audio.get('data', '')) > 1000 and 'text' in parts[-1], 'analysis sends the song as inline 16 kHz WAV before the prompt')
    info = await pg.evaluate('J.ui.project.songInfo')
    expect(info and info['sections'][1]['kind'] == 'chorus' and info['name'] == 'tone.wav', f'analysis saved with the project {info and info["sections"]}')
    await pg.click('#aiPropose'); await pg.wait_for_selector('#aiResult button[data-k="0"]')
    expect('Song analysis (from the audio)' in seen[-1]['body']['contents'][0]['parts'][-1]['text'], 'proposals get the song analysis as context')
    await pg.click('#aiAlign'); await pg.wait_for_selector('#aiResult [data-a=apply]')
    await pg.click('#aiResult [data-a=apply]'); await pg.wait_for_timeout(300)
    lt = await pg.evaluate('J.ui.project.timing.lineTimes')
    expect(lt.get('0') == 0.6 and lt.get('3') == 4, f'alignment sets the line start times {lt}')
    await pg.click('#aiTranscribe'); await pg.wait_for_selector('#aiResult [data-a=apply]')
    await pg.click('#aiResult [data-a=apply]'); await pg.wait_for_timeout(300)
    lyr = await pg.evaluate('J.ui.project.lyrics')
    expect(lyr.split('\n') == ['[00:00.50]はじまりの歌', '[00:02.00]光のほうへ', '[00:03.50]はじまりの歌'], 'transcription replaces the lyrics with timed lines: ' + lyr.replace('\n', ' / '))
    starts = await pg.evaluate('J.ui.plan.lines.map(l => l.start)')
    expect(starts == [0.5, 2, 3.5], f'the plan follows the transcribed times {starts}')
    await pg.click('#aiUndo'); await pg.wait_for_timeout(300)
    expect(await pg.evaluate('J.ui.project.lyrics') != lyr, 'transcription can be undone')
    await pg.select_option('#aiProvider', 'claude'); await pg.wait_for_timeout(100)
    expect(await pg.is_disabled('#aiTranscribe'), 'song buttons are off for the other service')
    await pg.select_option('#aiProvider', 'gemini')

    await pg.click('#aiClose')
    expect(not await pg.is_visible('#aiPanel'), 'panel closes')
    csp = await pg.evaluate('window.__csp')
    expect(not csp, f'no CSP violations {csp}')
    expect(not errs, f'no page errors {errs}')
    await pg.close()
    return ok


async def main():
    srv = serve()
    base = f'http://127.0.0.1:{srv.server_address[1]}'
    if SHOTS: os.makedirs(SHOTS, exist_ok=True)
    async with async_playwright() as p:
        b = await launch(p)
        results = []
        for page in PAGES:
            print('==', page)
            results.append(await check(b, base, page))
        await b.close()
    srv.shutdown()
    print('AI panel check', 'OK' if all(results) else 'FAILED')
    sys.exit(0 if all(results) else 1)

asyncio.run(main())
