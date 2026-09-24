"""Measure, from a real browser page, whether the AI APIs can be called directly (CORS) and what an error looks like.
No API key is needed: a dummy key is sent, so every call must come back as a readable auth error, not a CORS failure.
Runs inside the built index.html, so the page's CSP is in force too.
usage: python3 build.py && python3 dev/ai_probe.py [--origin-note]   -> prints a JSON report"""
import asyncio, functools, http.server, json, os, sys, threading
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from browser import launch, new_page

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROBE = r"""
async () => {
  const out = {};
  const KEY = 'dummy-key-for-cors-probe';
  const readable = async (label, fn) => {
    const t0 = performance.now();
    try { const r = await fn(); out[label] = Object.assign({ ms: Math.round(performance.now() - t0) }, r); }
    catch (e) { out[label] = { ms: Math.round(performance.now() - t0), threw: String(e && e.message || e).slice(0, 200), name: e && e.name, status: e && e.status }; }
  };
  const G = 'https://generativelanguage.googleapis.com/v1beta/models/';
  await readable('gemini.generateContent', async () => {
    const r = await fetch(G + 'gemini-3.8-flash:generateContent', { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }], generationConfig: { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'LOW' } } }) });
    const j = await r.json().catch(() => null);
    return { status: r.status, bodyReadable: !!j, error: j && j.error && (j.error.status + ' ' + (j.error.details || []).map(d => d.reason).filter(Boolean).join(',')) };
  });
  await readable('gemini.streamGenerateContent(sse)', async () => {
    const r = await fetch(G + 'gemini-3.8-flash:streamGenerateContent?alt=sse', { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }) });
    const t = await r.text();
    return { status: r.status, bodyReadable: t.length > 0 };
  });
  await readable('gemini.models.get', async () => {
    const r = await fetch(G + 'gemini-3.8-flash', { headers: { 'x-goog-api-key': KEY } });
    return { status: r.status, bodyReadable: !!(await r.json().catch(() => null)) };
  });
  await readable('claude.sdk.messages.create', async () => {
    if (!window.AnthropicSDK) return { skipped: 'SDK not in this page' };
    const c = new window.AnthropicSDK({ apiKey: KEY, dangerouslyAllowBrowser: true, maxRetries: 0 });
    try { await c.messages.create({ model: 'claude-opus-5', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] }); return { status: 200 }; }
    catch (e) { return { status: e.status, errorClass: e.constructor && e.constructor.name, isAuthError: e instanceof window.AnthropicSDK.AuthenticationError, bodyReadable: !!(e.error && e.error.error) }; }
  });
  return out;
}
"""


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


async def main():
    srv = serve()
    async with async_playwright() as p:
        b = await launch(p)
        pg = await new_page(b)
        await pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/index.html', wait_until='domcontentloaded')
        await pg.wait_for_function('() => window.J && J.ui')
        report = await pg.evaluate(PROBE)
        report['_origin'] = f'http://127.0.0.1:{srv.server_address[1]}'
        report['_browser'] = b.version
        print(json.dumps(report, ensure_ascii=False, indent=1))
        await b.close()
    srv.shutdown()

asyncio.run(main())
