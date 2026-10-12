#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Real frontend → external AAC server integration, JA and EN.

Starts the deployable FastAPI service locally. Playwright bridges the configured HTTPS test origin to that real
HTTP service, preserving authentication, CORS and multipart bytes. The app creates native silent H.264 and original
48 kHz stereo PCM; FFmpeg adds AAC at 320 kbps. FFprobe verifies the audio, frame count, zero PTS and identical video
packet hashes. MP4, Filmora ZIP and folder exercise the actual export buttons; no browser AudioEncoder is used.
Settings/health never upload music, tokens stay out of projects, silent comparisons survive mode changes, and auth,
busy and cancellation failures leave no partial downloads or folders. Busy and held-network responses are deliberately
simulated at the bridge; backend concurrency/disconnection itself is covered by server/audio's service tests.

Requires server/audio/requirements-test.txt and ffmpeg/ffprobe. Native H.264 is required by the service contract.
Run: PW_EXECUTABLE=/usr/bin/chromium python3 tests/browser/audio_server.py [--flow settings|success|errors|cancel]
"""
import argparse
import asyncio
import base64
from email.parser import BytesParser
from email.policy import default
import hashlib
import io
import json
import math
import os
from pathlib import Path
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import wave
import zipfile

import httpx
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
from browser import launch, new_page  # noqa: E402
from ui_flows import DOC, DONE, FONT_HOSTS, LYRICS, RECORD, Flow, ensure_built, serve  # noqa: E402

ENDPOINT = 'https://audio-test.example.test'
TOKEN = 'browser-test-only-token'
URL = '[data-audio-server="url"]'
SECRET = '[data-audio-server="token"]'
MODE = '[data-seg="audioEncoding"] [data-v="server"]'
CHECK = '[data-act="audio-server.check"]'
START = '[data-act="export.start"]'
INIT = RECORD + """
Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });
"""
SONG = r"""async () => {
  const a = window.__mv, rate = 48000, seconds = 18, n = rate * seconds;
  const buffer = new ArrayBuffer(44 + n * 4), v = new DataView(buffer);
  const text = (at, s) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); text(8, 'WAVE'); text(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, n * 4, true);
  let state = 0x31415926;
  const noise = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296 * 2 - 1; };
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) {
    const x = 0.18 * noise() + 0.09 * Math.sin(2 * Math.PI * (c ? 997 : 440) * i / rate);
    v.setInt16(44 + i * 4 + c * 2, Math.round(x * 32767), true);
  }
  await a.loadSong(new File([buffer], 'original-source.wav', { type: 'audio/wav' }));
  return { ready: a.songReady(), rate: a.buffer && a.buffer.sampleRate, channels: a.buffer && a.buffer.numberOfChannels };
}"""
SPIES = r"""() => {
  const a = window.__mv, ex = a.svc.exporter, sink = ex.sink;
  window.__audioEncoders = 0; window.__videoJobs = []; window.__downloads = []; window.__finalSinks = []; window.__finalDirs = []; window.__phases = [];
  const AE = window.AudioEncoder, VE = window.VideoEncoder;
  window.AudioEncoder = class extends AE { constructor(o) { super(o); window.__audioEncoders++; } };
  window.VideoEncoder = class extends VE {
    constructor(o) { super(o); this.testJob = { frames: 0 }; window.__videoJobs.push(this.testJob); }
    configure(c) { this.testJob.codec = c.codec; this.testJob.w = c.width; this.testJob.h = c.height; super.configure(c); }
    encode(v, o) { this.testJob.frames++; super.encode(v, o); }
  };
  const watchAbort = (s) => {
    s.testAborted = false; const abort = s.abort;
    s.abort = async () => { s.testAborted = true; return abort(); }; return s;
  };
  ex.sink = Object.assign({}, sink, {
    openSink: async (o) => { const s = watchAbort(sink.createMemorySink({ name: o.name, type: 'video/mp4' })); window.__finalSinks.push(s); return s; },
    openDirectory: async (o) => { const d = await sink.openDirectory(o); if (d) { watchAbort(d); window.__finalDirs.push(d); } return d; },
    downloadBlob: (blob, name) => { window.__downloads.push({ blob, name }); },
  });
  a.bus.on('export', (s) => { if (s.part === 'audioServer') window.__phases.push({ phase: s.phase, i: s.i, N: s.N }); });
}"""


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def inspect_video(path):
    def run(*args):
        return json.loads(subprocess.check_output(['ffprobe', '-v', 'error', *args, '-of', 'json', str(path)]))
    info = run('-count_frames', '-show_streams', '-show_format')
    packets = run('-select_streams', 'v:0', '-show_packets', '-show_data_hash', 'sha256',
                  '-show_entries', 'packet=pts_time,dts_time,data_hash')['packets']
    return info, packets


class Bridge:
    def __init__(self, origin, backend, folder):
        self.origin, self.backend, self.folder = origin, backend, Path(folder)
        self.requests, self.conversions = [], []
        self.mode = 'real'
        self.arrived, self.release = asyncio.Event(), asyncio.Event()
        self.client = httpx.AsyncClient(trust_env=False, timeout=60)

    def headers(self):
        return {'access-control-allow-origin': self.origin,
                'access-control-allow-headers': 'authorization,content-type',
                'access-control-allow-methods': 'GET,POST,OPTIONS'}

    async def route(self, route):
        request = route.request
        headers = await request.all_headers()
        body = request.post_data_buffer or b''
        path = request.url[len(ENDPOINT):]
        item = {'method': request.method, 'path': path, 'bytes': len(body), 'auth': headers.get('authorization')}
        self.requests.append(item)
        if request.method == 'POST':
            mime = BytesParser(policy=default).parsebytes(('Content-Type: ' + headers['content-type'] + '\r\n\r\n').encode() + body)
            fields = {p.get_param('name', header='content-disposition'): p.get_payload(decode=True) for p in mime.iter_parts()}
            item['fields'] = fields
            self.arrived.set()
            if self.mode == 'busy':
                await route.fulfill(status=429, headers={**self.headers(), 'content-type': 'application/json'},
                                    body=json.dumps({'code': 'server_busy', 'message': 'Busy'}))
                return
            if self.mode == 'hold':
                await self.release.wait()
                try:
                    await route.abort()
                except Exception:
                    pass  # the cancelled page request has already gone away
                return
        forwarded = {k: v for k, v in headers.items() if k not in ('host', 'content-length', 'accept-encoding')}
        response = await self.client.request(request.method, self.backend + path, headers=forwarded, content=body)
        response_headers = {k: v for k, v in response.headers.items() if k not in ('content-encoding', 'transfer-encoding')}
        if request.method == 'POST' and response.status_code == 200:
            number = len(self.conversions)
            source, output = self.folder / ('source-%d.mp4' % number), self.folder / ('converted-%d.mp4' % number)
            source.write_bytes(item['fields']['video'])
            output.write_bytes(response.content)
            record = {'source': source, 'output': output, 'fields': item['fields'], 'headers': response_headers,
                      'sha256': hashlib.sha256(response.content).hexdigest()}
            self.conversions.append(record)
        await route.fulfill(status=response.status_code, headers=response_headers, body=response.content)

    async def close(self):
        self.release.set()
        await self.client.aclose()


async def open_test(browser, base, rel, bridge):
    page = await new_page(browser, viewport={'width': 1440, 'height': 1000})
    await page.add_init_script(INIT)
    for host in FONT_HOSTS:
        await page.route(host, lambda r: r.abort())
    await page.route(ENDPOINT + '/**', bridge.route)
    await page.goto(base + rel + '?fresh=1&test=1', wait_until='load')
    await page.wait_for_function('window.__mv && window.__mv.ready')
    await page.evaluate('async () => { await window.__mv.ready; }')
    return page


async def setup(f, song=True, seconds=1):
    await f.page.evaluate("""(text) => { const a = window.__mv; a.view.setPref('autoplay', false);
      a.dispatch({ t: 'lyrics.set', text }, { label: ['undo.paste', {}] }); a.store.seal(); a.firstRun(); a.pause(); }""", LYRICS)
    await f.until('() => window.__mv.plan && window.__mv.plan.lines.length > 3', 'lyrics ready', timeout=15000)
    if song:
        ready = await f.page.evaluate(SONG)
        f.check(ready == {'ready': True, 'rate': 48000, 'channels': 2}, 'original stereo 48 kHz source decoded')
    await f.page.evaluate("""(seconds) => { const a = window.__mv; a.batch({ label: ['undo.output', {}] }, [
      { t: 'output.set', key: 'short', v: 720 }, { t: 'output.set', key: 'fps', v: 24 },
      { t: 'output.set', key: 'quality', v: 'light' }, { t: 'output.set', key: 'range', v: { t0: 1, t1: 1 + seconds } },
    ]); a.store.seal(); a.goStep('export'); a.pause(); }""", seconds)
    await f.until('() => !!window.__mv.exportProbe()', 'native codec probed', timeout=15000)
    f.check(await f.page.evaluate('() => !!window.__mv.exportProbe().codec'), 'native H.264 encoder available')
    await f.page.evaluate(SPIES)


async def configure(f, token=TOKEN):
    await f.page.locator(MODE).click()
    await f.page.locator(URL).fill(ENDPOINT)
    await f.page.locator(SECRET).fill(token)
    await f.settle(2)


async def export(f):
    await f.page.locator(START).click()
    await f.until('() => ["done", "error"].includes(window.__mv.exportState().phase)', 'export finishes', timeout=120000)
    return await f.page.evaluate("""() => { const s = window.__mv.exportState(); return { phase: s.phase, message: s.message,
      result: s.result ? { frames: s.result.frames, audioCodec: s.result.audioCodec, audioBitrate: s.result.audioBitrate,
        audioSource: s.result.audioSource, measured: s.result.audioMeasuredBitrate,
        folder: s.result.folder,
        files: s.result.files && s.result.files.map(({ name, kind }) => ({ name, kind })) } : null }; }""")


async def flow_settings(f, bridge):
    page = f.page
    await setup(f, song=False, seconds=0.25)
    f.check(await page.locator(MODE).is_disabled(), 'server choice disabled until original song is loaded')
    await page.evaluate(SONG)
    await page.locator('[data-act="quality-preview.start"]').click()
    await f.until('() => document.querySelector(".export-quality-preview").dataset.previewPhase === "done"', 'four silent clips ready', timeout=60000)
    urls = await page.evaluate('() => [...document.querySelectorAll("[data-preview-quality] video")].map((v) => v.src)')
    before = await page.evaluate(DONE)
    await page.locator(MODE).click()
    f.check(await page.evaluate(DONE) == before + 1, 'explicit server mode is one undo entry')
    f.check(await page.evaluate('() => [...document.querySelectorAll("[data-preview-quality] video")].map((v) => v.src)') == urls,
            'silent comparison URLs survive audio encoding mode choice')
    f.check(not bridge.requests, 'opening server settings and silent comparisons upload nothing')
    f.check(await page.evaluate('() => window.__mv.exportChecks().some((c) => c.code === "audio-server-config" && c.level === "block")'),
            'missing URL/token blocks full export')
    doc0, undo0 = await page.evaluate(DOC), await page.evaluate(DONE)
    await page.locator(URL).fill(ENDPOINT)
    await page.locator(SECRET).fill(TOKEN)
    f.check(not bridge.requests, 'typing configuration sends no request')
    f.check(await page.evaluate(DOC) == doc0 and await page.evaluate(DONE) == undo0, 'device configuration does not edit project/history')
    storage = await page.evaluate('() => [localStorage.getItem("mojipv.audioServer.url"), sessionStorage.getItem("mojipv.audioServer.token")]')
    f.check(storage == [ENDPOINT, TOKEN] and TOKEN not in doc0 and ENDPOINT not in doc0, 'URL is device-local and token session-only, outside project')
    f.check(await page.evaluate('() => localStorage.getItem("mojipv.audioServer.token")') is None, 'token is never persisted in localStorage')
    f.check(await page.evaluate('(token) => !MV.use("core/doc").serialize({ doc: window.__mv.doc, side: window.__mv.store.side }).includes(token)', TOKEN),
            'serialized project and side history contain no token')
    await page.locator(CHECK).click()
    await f.until('() => document.querySelector(".audio-server-settings").dataset.audioServerState === "ready"', 'health check ready', timeout=15000)
    f.check(all(r['method'] in ('GET', 'OPTIONS') and r['bytes'] == 0 and not r['auth'] for r in bridge.requests),
            'real health check sends no token or media')
    await page.locator(URL).fill('http://insecure.example.test')
    f.check(await page.evaluate('() => localStorage.getItem("mojipv.audioServer.url")') is None, 'invalid URL clears previously saved endpoint')
    f.check(await page.locator(START).is_disabled(), 'insecure URL blocks export')
    await page.locator(URL).fill(ENDPOINT)
    await page.locator(SECRET).fill('')
    f.check(await page.locator(START).is_disabled(), 'missing token blocks conversion')


def validate_conversion(f, conversion, duration, original_samples):
    original, op = inspect_video(conversion['source'])
    converted, cp = inspect_video(conversion['output'])
    video = next(s for s in converted['streams'] if s['codec_type'] == 'video')
    audio = next(s for s in converted['streams'] if s['codec_type'] == 'audio')
    f.check(len(original['streams']) == 1 and original['streams'][0]['codec_name'] == 'h264', 'upload is native silent H.264')
    f.check([p['data_hash'] for p in op] == [p['data_hash'] for p in cp], 'server copies every video packet without a second encode')
    f.check(float(video.get('start_time', '0')) == 0 and float(cp[0]['pts_time']) == 0, 'server output video starts at zero PTS')
    f.check(int(video['nb_read_frames']) == round(duration * 24) and abs(float(video['duration']) - duration) < 0.002,
            'converted video retains all selected frames and duration')
    f.check(audio['codec_name'] == 'aac' and audio['sample_rate'] == '48000' and audio['channels'] == 2,
            'server output has AAC, stereo 48 kHz')
    f.check(abs(float(audio['duration']) - duration) < 0.05, 'AAC duration matches rendered video')
    measured = int(audio['bit_rate'])
    f.check(280000 <= measured <= 350000, 'broadband original source encodes near 320 kbps (%d)' % measured)
    print('info  AAC %d bps · %g s · %d original H.264 packets' % (measured, duration, len(cp)), flush=True)
    with wave.open(io.BytesIO(conversion['fields']['audio']), 'rb') as wav:
        f.check((wav.getnchannels(), wav.getframerate(), wav.getsampwidth(), wav.getnframes()) == (2, 48000, 2, round(duration * 48000)),
                'uploaded audio is exact-range original PCM16 stereo WAV')
        first = struct.unpack('<64h', wav.readframes(32))
        expected = [math.floor(original_samples[c][i] * 32767 + 0.5) for i in range(32) for c in range(2)]
        f.check(list(first) == expected, 'uploaded PCM begins at the selected original source samples, without a lossy intermediate')


async def flow_success(f, bridge):
    page = f.page
    await setup(f, seconds=10)
    await configure(f)
    original_samples = await page.evaluate('() => [0, 1].map((c) => [...window.__mv.buffer.getChannelData(c).slice(48000, 48032)])')
    for format_, duration, directory in (('mp4', 10, False), ('kit', 2, False), ('kit', 2, True)):
        if await page.evaluate('() => window.__mv.exportState().phase') != 'idle':
            await page.evaluate('() => window.__mv.exportReset()')
        await page.evaluate("""([fmt, seconds]) => { const a = window.__mv; a.batch({ label: ['undo.output', {}] }, [
          ...MV.use('ui/output').formatCmds(a.doc, fmt),
          { t: 'output.set', key: 'range', v: { t0: 1, t1: 1 + seconds } },
          { t: 'output.set', key: 'kit', v: { overlay: false, bg: false, green: false, srt: false, lrc: false } },
        ]); a.store.seal(); }""", [format_, duration])
        if directory:
            await page.evaluate("""async () => { const root = await navigator.storage.getDirectory();
              window.__serverParent = await root.getDirectoryHandle('audio_server_pick', { create: true });
              window.showDirectoryPicker = async () => window.__serverParent; }""")
        previous = len(bridge.conversions)
        state = await export(f)
        f.check(state['phase'] == 'done', 'real server %s %s export done: %r' % (format_, 'folder' if directory else 'memory', state))
        if state['phase'] != 'done' or len(bridge.conversions) != previous + 1:
            f.check(False, 'one real server conversion per export')
            return
        result = state['result']
        f.check(result['audioCodec'] == 'mp4a.40.2' and result['audioBitrate'] == 320000 and result['audioSource'] == 'server',
                'result reports external AAC 320 kbps')
        validate_conversion(f, bridge.conversions[-1], duration, original_samples)
        if format_ == 'kit':
            f.check(sorted(x['kind'] for x in result['files']) == ['main', 'readme'], 'kit has main/README and no mini WAV or optional files')
            if not directory:
                encoded = await page.evaluate("""async () => { const b = new Uint8Array(await window.__mv.exportState().result.blob.arrayBuffer());
                  let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); }""")
                with zipfile.ZipFile(io.BytesIO(base64.b64decode(encoded))) as z:
                    mp4 = next(n for n in z.namelist() if n.endswith('.mp4'))
                    f.check(hashlib.sha256(z.read(mp4)).hexdigest() == bridge.conversions[-1]['sha256'], 'ZIP contains the exact converted AAC MP4')
            else:
                name = next(x['name'] for x in result['files'] if x['kind'] == 'main')
                digest = await page.evaluate("""async ([folder, name]) => { const d = await window.__serverParent.getDirectoryHandle(folder);
                  const bytes = await (await (await d.getFileHandle(name)).getFile()).arrayBuffer();
                  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((x) => x.toString(16).padStart(2, '0')).join(''); }""",
                                             [result['folder'], name])
                f.check(digest == bridge.conversions[-1]['sha256'], 'folder contains the exact converted AAC MP4')
        f.check(await page.evaluate('() => window.__audioEncoders') == 0, 'external export never encodes a lossy browser audio intermediate')
    f.check(await page.evaluate('() => window.__videoJobs.length') == 3, 'only one native video encode per MP4/kit export')
    f.check(await page.evaluate('() => window.__phases.length > 0 && window.__phases.every((x) => x.i === 0 && x.N === 0)'),
            'server phase reports indeterminate progress')
    f.check(await page.evaluate('(token) => !JSON.stringify(window.__mv.doc).includes(token)', TOKEN), 'conversion token never enters project')


async def flow_errors(f, bridge):
    page = f.page
    await setup(f)
    await configure(f, 'wrong-test-token')
    auth = await export(f)
    f.check(auth['phase'] == 'error' and bool(auth['message']), 'real backend 401 is a visible error')
    f.check(await page.evaluate('() => window.__downloads.length === 0 && window.__finalSinks.every((s) => s.bytes === 0)'),
            'auth error aborts all output and downloads nothing')
    await page.evaluate('() => window.__mv.exportReset()')
    await page.locator(SECRET).fill(TOKEN)
    bridge.mode = 'busy'
    busy = await export(f)
    f.check(busy['phase'] == 'error' and bool(busy['message']), 'HTTP 429 is a visible busy error')
    f.check(auth['message'] != busy['message'], 'auth and busy errors have distinct explanations')
    f.check(await page.evaluate('() => window.__audioEncoders === 0 && window.__downloads.length === 0 && window.__finalSinks.every((s) => s.bytes === 0)'),
            'errors do not fall back to browser audio or leave a partial MP4')
    # Bypass the disabled button, as another caller can do: the picker target already exists when the app's own
    # configuration/source checks fail before any host exporter has taken responsibility for cleaning it up.
    await page.evaluate('() => window.__mv.exportReset()')
    await page.locator(URL).fill('http://invalid-audio-server.example.test')
    sinks_before = await page.evaluate('() => window.__finalSinks.length')
    video_jobs = await page.evaluate('() => window.__videoJobs.length')
    requests_before = len(bridge.requests)
    await page.evaluate('async () => { await window.__mv.exportStart(); }')
    f.check(await page.evaluate('(n) => window.__mv.exportState().phase === "error" && window.__finalSinks.length === n + 1 && window.__finalSinks[n].testAborted && window.__finalSinks[n].bytes === 0', sinks_before),
            'invalid configuration aborts the empty MP4 target created before the host exporter runs')
    await page.evaluate('() => window.__mv.exportReset()')
    await page.locator(URL).fill(ENDPOINT)
    await page.evaluate("""async () => {
      const a = window.__mv; a.batch({ label: ['undo.output', {}] }, MV.use('ui/output').formatCmds(a.doc, 'kit'));
      const root = await navigator.storage.getDirectory();
      window.__earlyServerParent = await root.getDirectoryHandle('early_audio_server_pick', { create: true });
      const keep = await window.__earlyServerParent.getFileHandle('keep.txt', { create: true });
      const writer = await keep.createWritable(); await writer.write('existing parent file'); await writer.close();
      window.showDirectoryPicker = async () => window.__earlyServerParent;
      a.setSongBuffer(null); await a.exportStart();
    }""")
    missing = await page.evaluate("""async () => {
      const names = []; for await (const [name] of window.__earlyServerParent.entries()) names.push(name);
      return { phase: window.__mv.exportState().phase, names, dirs: window.__finalDirs.length,
        aborted: window.__finalDirs.every((d) => d.testAborted),
        keep: await (await (await window.__earlyServerParent.getFileHandle('keep.txt')).getFile()).text() };
    }""")
    f.check(missing == {'phase': 'error', 'names': ['keep.txt'], 'dirs': 1, 'aborted': True, 'keep': 'existing parent file'},
            'missing original audio removes the newly owned KIT folder and preserves the parent file: %r' % missing)
    f.check(await page.evaluate('() => window.__videoJobs.length') == video_jobs and len(bridge.requests) == requests_before,
            'early failures start no video encoding or server request')


async def flow_cancel(f, bridge):
    page = f.page
    await setup(f)
    await configure(f)
    bridge.mode = 'hold'
    for format_, directory in (('mp4', False), ('kit', True)):
        bridge.arrived.clear(); bridge.release.clear()
        await page.evaluate("""(fmt) => { const a = window.__mv; a.batch({ label: ['undo.output', {}] }, [
          ...MV.use('ui/output').formatCmds(a.doc, fmt),
          { t: 'output.set', key: 'kit', v: { overlay: false, bg: false, green: false, srt: false, lrc: false } },
        ]); a.store.seal(); }""", format_)
        if directory:
            await page.evaluate("""async () => { const root = await navigator.storage.getDirectory();
              window.__serverParent = await root.getDirectoryHandle('cancel_audio_server_pick', { create: true });
              window.showDirectoryPicker = async () => window.__serverParent; }""")
        await page.locator(START).click()
        await asyncio.wait_for(bridge.arrived.wait(), timeout=30)
        f.check(await page.evaluate('() => window.__mv.exportState().part === "audioServer"'), 'cancel occurs during external conversion')
        f.check(await page.evaluate('() => { const p = document.querySelector(".exp-running .progress.is-indeterminate"); return !!p && !p.hasAttribute("aria-valuenow"); }'),
                'remote conversion has indeterminate progress rather than a false frame percentage')
        await page.evaluate('() => window.__mv.actions.run("export.cancel")')
        await f.until('() => window.__mv.exportState().phase === "idle"', 'cancel settles idle', timeout=15000)
        bridge.release.set()
        await f.settle(2)
        if directory:
            names = await page.evaluate('async () => { const out = []; for await (const [n] of window.__serverParent.entries()) out.push(n); return out; }')
            f.check(names == [], 'cancel removes the newly created kit folder')
    f.check(await page.evaluate('() => window.__audioEncoders === 0 && window.__downloads.length === 0 && window.__finalSinks.every((s) => s.bytes === 0)'),
            'cancel leaves no audio fallback, file or download')


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root')
    ap.add_argument('--flow', choices=('settings', 'success', 'errors', 'cancel'))
    ap.add_argument('--no-build', action='store_true')
    args = ap.parse_args()
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        raise RuntimeError('Install ffmpeg/ffprobe for real server integration')
    root = Path(args.root).resolve() if args.root else ROOT
    if not args.no_build:
        ensure_built(root)
    server = serve(root)
    base = 'http://127.0.0.1:%d/' % server.server_address[1]
    port = free_port()
    env = dict(os.environ, AUDIO_SERVER_TOKEN=TOKEN, AUDIO_ALLOWED_ORIGINS=base.rstrip('/'), AUDIO_FFMPEG_THREADS='2')
    with tempfile.TemporaryDirectory(prefix='moji-audio-browser-') as temp:
        env['AUDIO_TEMP_DIR'] = str(Path(temp) / 'service')
        Path(env['AUDIO_TEMP_DIR']).mkdir()
        log = open(Path(temp) / 'server.log', 'w+')
        process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'service:create_app', '--factory', '--host', '127.0.0.1', '--port', str(port)],
                                   cwd=ROOT / 'server' / 'audio', env=env, stdout=log, stderr=subprocess.STDOUT)
        failures, count = [], 0
        try:
            async with httpx.AsyncClient(trust_env=False) as client:
                for _ in range(100):
                    try:
                        if (await client.get('http://127.0.0.1:%d/health' % port)).status_code == 200:
                            break
                    except httpx.HTTPError:
                        pass
                    await asyncio.sleep(0.1)
                else:
                    log.seek(0)
                    raise RuntimeError('Audio backend did not start: ' + log.read())
            async with async_playwright() as p:
                browser = await launch(p)
                try:
                    for rel, lang in (('index.html', 'ja'), ('en/index.html', 'en')):
                        for name, run in (('settings', flow_settings), ('success', flow_success), ('errors', flow_errors), ('cancel', flow_cancel)):
                            if args.flow and args.flow != name:
                                continue
                            bridge = Bridge(base.rstrip('/'), 'http://127.0.0.1:%d' % port, temp)
                            page = await open_test(browser, base, rel, bridge)
                            f = Flow(lang + '_' + name, page, None)
                            try:
                                await run(f, bridge)
                            except Exception as error:
                                f.problems.append(str(error))
                            f.problems += ['page error: ' + e for e in f.errors]
                            csp = await page.evaluate('() => window.__csp')
                            if csp:
                                f.problems.append('CSP: ' + repr(csp))
                            print(('FAIL ' if f.problems else 'ok   ') + f.name, flush=True)
                            for problem in f.problems:
                                print('  ' + problem, flush=True)
                            failures += [f.name + ': ' + p for p in f.problems]
                            count += 1
                            bridge.release.set()
                            await page.close()
                            await bridge.close()
                finally:
                    await browser.close()
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait()
            log.close()
            server.shutdown()
    print('audio_server.py: %s (%d JA/EN cases)' % ('FAILED' if failures else 'OK', count))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
