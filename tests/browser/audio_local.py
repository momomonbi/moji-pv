#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Native H.264 + real self-hosted FFmpeg WASM AAC, JA/EN.

Uses the compiled app and its actual CSP, pinned core assets and dedicated workers. No converter is faked: capture
the immutable video/PCM blobs handed to WORKERFS, then independently inspect actual output with native FFprobe.
Verifies 320 kbps AAC target/actual audio, original sample range, unchanged H.264 packet hashes/timing, one video
encode, no native AudioEncoder, MP4 and Filmora ZIP/folder, lazy first load and cached assets with a new worker per job.
Old projects that selected the removed server method open as local AAC and export without a settings prompt or upload.
Cancelling asset loading or the worker phase must leave no file/folder, terminate the worker, and permit another export.
Requires ffmpeg/ffprobe, Playwright and the self-hosted vendor/ffmpeg assets. Native H.264 is required.
Run: PW_EXECUTABLE=/usr/bin/chromium python3 tests/browser/audio_local.py [--flow settings|migration|success|cache|cancel]
"""
import argparse
import asyncio
import base64
import io
import math
from pathlib import Path
import shutil
import struct
import sys
import tempfile
import wave
import zipfile

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
from browser import launch, new_page  # noqa: E402
from ui_flows import FONT_HOSTS, LYRICS, RECORD, Flow, ensure_built, serve  # noqa: E402
from audio_fixture import SONG, inspect_video  # noqa: E402  (shared generated original audio and independent FFprobe)

MODE = '[data-seg="audioEncoding"] [data-v="local"]'
START = '[data-act="export.start"]'
INIT = RECORD + r"""
Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });
window.__workersCreated = 0; window.__workersTerminated = 0; window.__localInputs = []; window.__workerMessages = [];
const OriginalWorker = window.Worker;
const findBlobs = (value, seen = new Set(), out = []) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return out;
  seen.add(value);
  if (value instanceof Blob) { out.push(value); return out; }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return out;
  for (const child of Object.values(value)) findBlobs(child, seen, out);
  return out;
};
window.Worker = class extends OriginalWorker {
  constructor(...args) { super(...args); window.__workersCreated++; this.testEnded = false;
    this.addEventListener('message', ({ data }) => { if (data.kind !== 'progress') window.__workerMessages.push({ kind: data.kind, code: data.code, byteLength: data.bytes && data.bytes.byteLength }); });
  }
  postMessage(value, ...args) {
    const blobs = findBlobs(value);
    const video = blobs.find((b) => b.type === 'video/mp4');
    const audio = blobs.find((b) => b.type === 'audio/wav');
    if (video && audio) window.__localInputs.push({ video, audio });
    return super.postMessage(value, ...args);
  }
  terminate() { if (!this.testEnded) { this.testEnded = true; window.__workersTerminated++; } return super.terminate(); }
};
"""
SPIES = r"""() => {
  const a = window.__mv, ex = a.svc.exporter, sink = ex.sink;
  window.__audioEncoders = 0; window.__videoJobs = []; window.__downloads = []; window.__finalSinks = []; window.__localPhases = [];
  const AE = window.AudioEncoder, VE = window.VideoEncoder;
  window.AudioEncoder = class extends AE { constructor(o) { super(o); window.__audioEncoders++; } };
  window.VideoEncoder = class extends VE {
    constructor(o) { super(o); this.testJob = { frames: 0 }; window.__videoJobs.push(this.testJob); }
    configure(c) { this.testJob.codec = c.codec; super.configure(c); }
    encode(v, o) { this.testJob.frames++; super.encode(v, o); }
  };
  ex.sink = Object.assign({}, sink, {
    openSink: async (o) => {
      const s = sink.createMemorySink({ name: o.name, type: 'video/mp4' }), abort = s.abort;
      s.testAborted = false; s.abort = async () => { s.testAborted = true; return abort(); };
      window.__finalSinks.push(s); return s;
    },
    downloadBlob: (blob, name) => { window.__downloads.push({ blob, name }); },
  });
  a.bus.on('export', (s) => {
    if (!['audioLocalLoading', 'audioLocal'].includes(s.part)) return;
    const bar = document.querySelector('.exp-running [role="progressbar"]');
    window.__localPhases.push({ part: s.part, i: s.i, N: s.N,
      indeterminate: !!bar && bar.classList.contains('is-indeterminate'), now: bar && bar.getAttribute('aria-valuenow') });
  });
}"""
BLOB = r"""async ({ kind, index }) => {
  const item = window.__localInputs[index];
  const blob = kind === 'video' ? item.video : item.audio;
  const bytes = new Uint8Array(await blob.arrayBuffer()); let s = '';
  for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
}"""
OUTPUT = r"""async () => {
  const bytes = new Uint8Array(await window.__mv.exportState().result.blob.arrayBuffer()); let s = '';
  for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
}"""


class Network:
    def __init__(self, context):
        self.requests = []
        context.on('request', lambda r: self.requests.append((r.method, r.url)))

    def assets(self):
        return [r for r in self.requests if '/vendor/ffmpeg/' in r[1]]

    def posts(self):
        return [r for r in self.requests if r[0] == 'POST']


async def open_test(browser, base, rel):
    page = await new_page(browser, viewport={'width': 1440, 'height': 1000})
    network = Network(page.context)
    await page.add_init_script(INIT)
    for host in FONT_HOSTS:
        await page.route(host, lambda route: route.abort())
    await page.goto(base + rel + '?fresh=1&test=1', wait_until='load')
    await page.wait_for_function('window.__mv && window.__mv.ready')
    await page.evaluate('async () => { await window.__mv.ready; }')
    return page, network


async def setup(f, seconds=1, song=True):
    page = f.page
    await page.evaluate("""(text) => { const a = window.__mv; a.view.setPref('autoplay', false);
      a.dispatch({ t: 'lyrics.set', text }, { label: ['undo.paste', {}] }); a.store.seal(); a.firstRun(); a.pause(); }""", LYRICS)
    await f.until('() => window.__mv.plan && window.__mv.plan.lines.length > 3', 'lyrics planned', timeout=15000)
    if song:
        f.check(await page.evaluate(SONG) == {'ready': True, 'rate': 48000, 'channels': 2}, 'original stereo 48 kHz source loaded')
    await page.evaluate("""(seconds) => { const a = window.__mv; a.batch({ label: ['undo.output', {}] }, [
      { t: 'output.set', key: 'short', v: 720 }, { t: 'output.set', key: 'fps', v: 24 },
      { t: 'output.set', key: 'quality', v: 'light' }, { t: 'output.set', key: 'range', v: { t0: 1, t1: 1 + seconds } },
    ]); a.store.seal(); a.goStep('export'); a.pause(); }""", seconds)
    await f.until('() => !!window.__mv.exportProbe()', 'native encoder probed', timeout=15000)
    f.check(await page.evaluate('() => !!window.__mv.exportProbe().codec'), 'native H.264 available')
    await page.evaluate(SPIES)


async def export(f):
    await f.page.locator(START).click()
    await f.until('() => ["done", "error"].includes(window.__mv.exportState().phase)', 'real WASM export completed', timeout=180000)
    return await f.page.evaluate("""() => { const s = window.__mv.exportState(); return { phase: s.phase, message: s.message,
      result: s.result && { frames: s.result.frames, audioCodec: s.result.audioCodec, audioBitrate: s.result.audioBitrate,
        audioSource: s.result.audioSource, folder: s.result.folder,
        files: s.result.files && s.result.files.map(({ name, kind }) => ({ name, kind })) } }; }""")


def validate(f, original, output, pcm, seconds, samples):
    before, bp = inspect_video(original)
    after, ap = inspect_video(output)
    video = next(s for s in after['streams'] if s['codec_type'] == 'video')
    audio = next(s for s in after['streams'] if s['codec_type'] == 'audio')
    f.check(len(before['streams']) == 1 and before['streams'][0]['codec_name'] == 'h264', 'WASM receives silent H.264')
    f.check([p['data_hash'] for p in bp] == [p['data_hash'] for p in ap], 'every original H.264 packet is copied without re-encoding')
    f.check(float(video.get('start_time', '0')) == 0 and float(ap[0]['pts_time']) == 0, 'local output has zero video PTS')
    f.check(int(video['nb_read_frames']) == round(seconds * 24) and abs(float(video['duration']) - seconds) < 0.002,
            'local output preserves frame count/fps/duration')
    f.check(audio['codec_name'] == 'aac' and audio['sample_rate'] == '48000' and audio['channels'] == 2, 'real WASM output contains AAC stereo 48 kHz')
    f.check(abs(float(audio['duration']) - seconds) < 0.05, 'AAC and original video remain synchronized')
    bits = int(audio['bit_rate'])
    f.check(280000 <= bits <= 350000, 'original broadband source is near the 320 kbps target (%d)' % bits)
    with wave.open(io.BytesIO(pcm), 'rb') as wav:
        f.check((wav.getnchannels(), wav.getframerate(), wav.getsampwidth(), wav.getnframes()) == (2, 48000, 2, round(seconds * 48000)),
                'worker receives exact-range PCM16 stereo 48 kHz WAV')
        first = struct.unpack('<64h', wav.readframes(32))
        expected = [math.floor(samples[c][i] * 32767 + 0.5) for i in range(32) for c in range(2)]
        f.check(list(first) == expected, 'worker PCM starts at the selected original samples, not a lossy intermediate')
    print('info  %s local AAC %d bps · %g s · %d copied H.264 packets' % (f.name, bits, seconds, len(ap)), flush=True)


async def flow_settings(f, network, folder):
    page = f.page
    await setup(f, seconds=0.25)
    f.check(await page.evaluate('() => window.__mv.doc.output.audioEncoding') == 'local', 'new projects default to local AAC')
    f.check(await page.locator(MODE).get_attribute('aria-checked') == 'true', 'local AAC is selected without configuration')
    f.check(await page.locator('.audio-server-settings').count() == 0, 'external server settings have been removed')
    f.check(await page.locator('[data-seg="audioEncoding"] [data-v="server"]').count() == 0,
            'the removed server method is absent from audio choices')
    f.check(not network.assets() and not network.posts(), 'opening local settings loads no core and sends no music')
    await page.locator('[data-act="quality-preview.start"]').click()
    await f.until('() => document.querySelector(".export-quality-preview").dataset.previewPhase === "done"', 'four silent native previews', timeout=60000)
    urls = await page.evaluate('() => [...document.querySelectorAll("[data-preview-quality] video")].map((v) => v.src)')
    await page.locator('[data-seg="audioEncoding"] [data-v="browser"]').click()
    await page.locator(MODE).click()
    f.check(await page.evaluate('() => [...document.querySelectorAll("[data-preview-quality] video")].map((v) => v.src)') == urls,
            'silent preview URLs survive audio method changes')
    f.check(not network.assets() and not network.posts() and await page.evaluate('() => window.__workersCreated') == 0,
            'silent comparison neither loads AAC WASM nor uploads audio')


async def flow_migration(f, network, folder):
    page = f.page
    await setup(f, seconds=1)
    samples = await page.evaluate('() => [0, 1].map((c) => [...window.__mv.buffer.getChannelData(c).slice(48000, 48032)])')
    restored = await page.evaluate(r"""async () => {
      const a = window.__mv, D = MV.use('core/doc');
      const legacy = JSON.parse(D.serialize({ doc: a.doc, side: a.store.side }));
      legacy.doc.output.audioEncoding = 'server';
      const expected = { sheet: legacy.doc.sheet, timing: legacy.doc.timing, pins: legacy.doc.pins,
        quality: legacy.doc.output.quality, range: legacy.doc.output.range };
      await a.io.openFiles([new File([JSON.stringify(legacy)], 'legacy-server.json', { type: 'application/json' })]);
      a.goStep('export'); a.pause();
      const saved = JSON.parse(D.serialize({ doc: a.doc, side: a.store.side }));
      return { actual: { sheet: a.doc.sheet, timing: a.doc.timing, pins: a.doc.pins,
          quality: a.doc.output.quality, range: a.doc.output.range }, expected,
        encoding: a.doc.output.audioEncoding, savedEncoding: saved.doc.output.audioEncoding, song: a.songReady() };
    }""")
    f.check(restored['actual'] == restored['expected'], 'opening a legacy server project preserves lyrics, timings, pins and output settings')
    f.check(restored['encoding'] == 'local' and restored['savedEncoding'] == 'local',
            'legacy server mode becomes local AAC on open and on save')
    f.check(restored['song'], 'legacy project retains its loaded original audio')
    f.check(await page.locator(MODE).get_attribute('aria-checked') == 'true'
            and await page.locator('.audio-server-settings, [data-seg="audioEncoding"] [data-v="server"]').count() == 0,
            'migrated project selects local AAC without a server choice or settings')
    await f.until('() => !!window.__mv.exportProbe()', 'migrated native encoder probed', timeout=15000)
    state = await export(f)
    f.check(state['phase'] == 'done' and state['result']['audioSource'] == 'local',
            'a reopened server project exports through real local AAC without configuration')
    if state['phase'] == 'done':
        original, output = Path(folder) / 'migrated-original.mp4', Path(folder) / 'migrated-local.mp4'
        original.write_bytes(base64.b64decode(await page.evaluate(BLOB, {'kind': 'video', 'index': 0})))
        output.write_bytes(base64.b64decode(await page.evaluate(OUTPUT)))
        pcm = base64.b64decode(await page.evaluate(BLOB, {'kind': 'audio', 'index': 0}))
        validate(f, original, output, pcm, 1, samples)
    f.check(not network.posts(), 'opening and exporting the legacy server project never uploads media')


async def flow_success(f, network, folder):
    page = f.page
    await setup(f, seconds=10)
    samples = await page.evaluate('() => [0, 1].map((c) => [...window.__mv.buffer.getChannelData(c).slice(48000, 48032)])')
    for number, (format_, seconds, directory) in enumerate((('mp4', 10, False), ('kit', 2, False), ('kit', 2, True))):
        if number:
            await page.evaluate('() => window.__mv.exportReset()')
        await page.evaluate("""([fmt, seconds]) => { const a = window.__mv; a.batch({ label: ['undo.output', {}] }, [
          ...MV.use('ui/output').formatCmds(a.doc, fmt), { t: 'output.set', key: 'range', v: { t0: 1, t1: 1 + seconds } },
          { t: 'output.set', key: 'kit', v: { overlay: false, bg: false, green: false, srt: false, lrc: false } },
        ]); a.store.seal(); }""", [format_, seconds])
        if directory:
            await page.evaluate("""async () => { const root = await navigator.storage.getDirectory();
              window.__localParent = await root.getDirectoryHandle('local_audio_pick', { create: true });
              window.showDirectoryPicker = async () => window.__localParent; }""")
        state = await export(f)
        f.check(state['phase'] == 'done', 'real local %s export completes: %r' % (format_, state))
        if state['phase'] != 'done':
            print('info  worker diagnostics ' + repr(await page.evaluate('() => window.__workerMessages')), flush=True)
            if await page.evaluate('() => window.__localInputs.length'):
                for kind, suffix in (('video', 'mp4'), ('audio', 'wav')):
                    Path('/tmp/moji-local-failed-' + f.name + '.' + suffix).write_bytes(base64.b64decode(await page.evaluate(BLOB, {'kind': kind, 'index': number})))
            return
        result = state['result']
        f.check(result['audioCodec'] == 'mp4a.40.2' and result['audioBitrate'] == 320000 and result['audioSource'] == 'local', 'result identifies local AAC 320 kbps target')
        f.check(await page.evaluate('() => window.__localInputs.length') == number + 1, 'one Blob/WORKERFS conversion per export')
        original = Path(folder) / ('original-%d.mp4' % number)
        output = Path(folder) / ('local-%d.mp4' % number)
        original.write_bytes(base64.b64decode(await page.evaluate(BLOB, {'kind': 'video', 'index': number})))
        pcm = base64.b64decode(await page.evaluate(BLOB, {'kind': 'audio', 'index': number}))
        if directory:
            name = next(x['name'] for x in result['files'] if x['kind'] == 'main')
            encoded = await page.evaluate("""async ([folder, name]) => {
              const d = await window.__localParent.getDirectoryHandle(folder);
              const b = new Uint8Array(await (await (await d.getFileHandle(name)).getFile()).arrayBuffer()); let s = '';
              for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); }""", [result['folder'], name])
            output.write_bytes(base64.b64decode(encoded))
        else:
            data = base64.b64decode(await page.evaluate(OUTPUT))
            if format_ == 'kit':
                with zipfile.ZipFile(io.BytesIO(data)) as z:
                    output.write_bytes(z.read(next(n for n in z.namelist() if n.endswith('.mp4'))))
            else:
                output.write_bytes(data)
        if format_ == 'kit':
            f.check(sorted(x['kind'] for x in result['files']) == ['main', 'readme'], 'local Filmora export needs no separate WAV')
        validate(f, original, output, pcm, seconds, samples)
    f.check(await page.evaluate('() => window.__videoJobs.length === 3 && window.__audioEncoders === 0'), 'one native video encode and zero browser AudioEncoders per export')
    f.check(await page.evaluate('() => window.__workersCreated === 3 && window.__workersTerminated === 3'), 'each completed job releases its worker/heap')
    f.check(not network.posts(), 'local conversion never uploads source media')
    phases = await page.evaluate('() => window.__localPhases')
    f.check(phases and all(p['now'] is None and p['indeterminate'] for p in phases), 'local loading/conversion shows honest indeterminate progress')


async def flow_cache(f, network, folder):
    page = f.page
    await setup(f, seconds=1)
    f.check(not network.assets(), 'core assets are lazy')
    first = await export(f)
    f.check(first['phase'] == 'done', 'first real AAC export loads core')
    assets = network.assets()[:]
    f.check(len(assets) == 2 and any(u.endswith('/ffmpeg-core.wasm') for _, u in assets) and any(u.endswith('/ffmpeg-core.js') for _, u in assets),
            'first export fetches only the actual pinned JS and WASM, not source archives')
    await page.evaluate('() => window.__mv.exportReset()')
    second = await export(f)
    f.check(second['phase'] == 'done', 'second real AAC export completes')
    f.check(network.assets() == assets, 'second job reuses cached assets without another download')
    f.check(await page.evaluate('() => window.__workersCreated === 2 && window.__workersTerminated === 2'), 'cache retains assets while every job gets and releases a fresh worker')


async def flow_cancel(f, network, folder):
    page = f.page
    await setup(f, seconds=10)
    arrived, release, finished = asyncio.Event(), asyncio.Event(), asyncio.Event()
    async def hold(route):
        arrived.set()
        try:
            await release.wait()
            try:
                await asyncio.wait_for(route.abort(), timeout=5)
            except Exception:
                pass  # The application may already have aborted this request.
        finally:
            finished.set()
    await page.context.route('**/vendor/ffmpeg/*.wasm', hold)
    try:
        await page.locator(START).click()
        await asyncio.wait_for(arrived.wait(), timeout=30)
        f.check(await page.evaluate('() => window.__mv.exportState().part === "audioLocalLoading"'), 'first-load cancellation happens during actual WASM asset loading')
        await page.evaluate('() => window.__mv.actions.run("export.cancel")')
        await f.until('() => window.__mv.exportState().phase === "idle"', 'asset load cancelled', timeout=15000)
    finally:
        release.set()
        if arrived.is_set():
            await asyncio.wait_for(finished.wait(), timeout=7)
        await page.context.unroute('**/vendor/ffmpeg/*.wasm', hold)
    f.check(await page.evaluate('() => window.__downloads.length === 0 && window.__finalSinks.every((s) => s.testAborted && s.bytes === 0)'), 'cancelled first load leaves no output')
    await page.evaluate("""async () => { const a = window.__mv;
      a.batch({ label: ['undo.output', {}] }, [ ...MV.use('ui/output').formatCmds(a.doc, 'kit'),
        { t: 'output.set', key: 'kit', v: { overlay: false, bg: false, green: false, srt: false, lrc: false } }]);
      const root = await navigator.storage.getDirectory(); window.__cancelLocalParent = await root.getDirectoryHandle('cancel_local_audio', { create: true });
      window.showDirectoryPicker = async () => window.__cancelLocalParent; }""")
    await page.locator(START).click()
    await f.until('() => window.__mv.exportState().part === "audioLocal" && window.__localInputs.length > 0', 'actual WORKERFS job reached worker', timeout=120000)
    await page.evaluate('() => window.__mv.actions.run("export.cancel")')
    await f.until('() => window.__mv.exportState().phase === "idle"', 'worker conversion cancelled', timeout=15000)
    names = await page.evaluate('async () => { const names = []; for await (const [n] of window.__cancelLocalParent.entries()) names.push(n); return names; }')
    f.check(names == [], 'cancelled worker phase removes the owned Filmora folder')
    f.check(await page.evaluate('() => window.__workersCreated === window.__workersTerminated && window.__downloads.length === 0'), 'cancel terminates the active worker and downloads nothing')
    await page.evaluate("""() => { const a = window.__mv; a.batch({ label: ['undo.output', {}] }, [
      ...MV.use('ui/output').formatCmds(a.doc, 'mp4'), { t: 'output.set', key: 'range', v: { t0: 1, t1: 2 } }]); }""")
    recovered = await export(f)
    f.check(recovered['phase'] == 'done', 'local AAC can export again after cancellation')


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root')
    ap.add_argument('--no-build', action='store_true')
    ap.add_argument('--flow', choices=('settings', 'migration', 'success', 'cache', 'cancel'))
    args = ap.parse_args()
    if not shutil.which('ffprobe'):
        raise RuntimeError('FFprobe is required for independent real-WASM verification')
    root = Path(args.root).resolve() if args.root else ROOT
    if not args.no_build:
        ensure_built(root)
    server = serve(root)
    base = 'http://127.0.0.1:%d/' % server.server_address[1]
    failures, cases = [], 0
    try:
        with tempfile.TemporaryDirectory(prefix='moji-local-aac-') as folder:
            async with async_playwright() as p:
                browser = await launch(p)
                try:
                    for rel, lang in (('index.html', 'ja'), ('en/index.html', 'en')):
                        for name, run in (('settings', flow_settings), ('migration', flow_migration), ('success', flow_success), ('cache', flow_cache), ('cancel', flow_cancel)):
                            if args.flow and args.flow != name:
                                continue
                            page, network = await open_test(browser, base, rel)
                            f = Flow(lang + '_' + name, page, None)
                            try:
                                await run(f, network, folder)
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
                            cases += 1
                            await page.close()
                finally:
                    await browser.close()
    finally:
        server.shutdown()
    print('audio_local.py: %s (%d JA/EN cases)' % ('FAILED' if failures else 'OK', cases))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
