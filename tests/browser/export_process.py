#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Native JA/EN export process UI: real stages, GPU preferences and cleanup.

The movie/image encoders, FFmpeg worker and container writers run normally. A real native flush is held after
completion so the finalizing UI can be inspected; a startup-only encoder quota error exercises safe fallback.
Hardware preference is compared with actual configure() calls and never treated as proof of GPU utilisation.
Run: PW_EXECUTABLE=/usr/bin/chromium python3 tests/browser/export_process.py [--no-build] [--shots DIR]
"""
import argparse
import asyncio
import json
from pathlib import Path
import sys

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
from browser import launch, new_page  # noqa: E402
from ui_flows import FONT_HOSTS, LYRICS, RECORD, ensure_built, serve  # noqa: E402
from audio_fixture import SONG  # noqa: E402

START = '[data-act="export.start"]'
INIT = RECORD + """
Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });
"""
SPIES = r"""() => {
  const app = window.__mv, sink = app.svc.exporter.sink;
  window.__processSnapshots = []; window.__processEncoders = []; window.__processAudio = 0;
  window.__processDownloads = []; window.__processSinks = [];
  window.__holdFlush = false; window.__nativeFlushHeld = false; window.__releaseFlush = null; window.__quota = false;
  app.svc.exporter.sink = Object.assign({}, sink, {
    openSink: async (o) => {
      const s = sink.createMemorySink({name: o.name}), abort = s.abort;
      s.testAborted = false; s.abort = async () => { s.testAborted = true; return abort(); };
      window.__processSinks.push(s); return s;
    },
    downloadBlob: (blob, name) => window.__processDownloads.push({blob, name}),
  });
  const original = window.VideoEncoder, originalAudio = window.AudioEncoder;
  window.VideoEncoder = class extends original {
    static async isConfigSupported(config) {
      if (window.__quota && config.hardwareAcceleration === 'prefer-hardware') {
        const answer = await original.isConfigSupported({...config, hardwareAcceleration: 'no-preference'});
        return {...answer, config: {...answer.config, hardwareAcceleration: 'prefer-hardware'}};
      }
      return original.isConfigSupported(config);
    }
    constructor(init) {
      super(init); this.record = {frames: 0, selected: null, codec: null, failed: false};
      window.__processEncoders.push(this);
    }
    configure(config) {
      if (window.__quota && config.hardwareAcceleration === 'prefer-hardware') {
        this.record.failed = true; throw new DOMException('GPU encoder busy', 'QuotaExceededError');
      }
      super.configure(config); this.record.selected = config.hardwareAcceleration; this.record.codec = config.codec;
    }
    encode(frame, options) { super.encode(frame, options); this.record.frames++; }
    async flush() {
      await super.flush();
      if (window.__holdFlush) {
        window.__holdFlush = false; window.__nativeFlushHeld = true;
        await new Promise((resolve) => { window.__releaseFlush = resolve; });
        window.__nativeFlushHeld = false;
      }
    }
  };
  if (originalAudio) window.AudioEncoder = class extends originalAudio {
    constructor(init) { super(init); window.__processAudio++; }
  };
  const snapshot = (s) => {
    const running = document.querySelector('.exp-running'), panel = running && running.querySelector('.exp-process');
    const el = (key) => panel && panel.querySelector('[data-export-' + key + ']');
    const stage = el('stage'), gpu = el('gpu'), audio = el('audio'), bar = running && running.querySelector('[role="progressbar"]');
    const phase = running && running.querySelector('.exp-phase');
    return {phase: s.phase, part: s.part, i: s.i, N: s.N, process: s.process && JSON.parse(JSON.stringify(s.process)),
      visible: !!panel && !running.hidden && !!panel.getClientRects().length,
      stage: stage && stage.dataset.exportStage, stageText: stage && stage.textContent,
      detail: el('stage-detail') && el('stage-detail').textContent,
      route: el('route') && el('route').textContent, gpu: gpu && gpu.dataset.status,
      gpuText: gpu && gpu.textContent, gpuNote: el('gpu-note') && el('gpu-note').textContent,
      audio: audio && audio.dataset.source, audioText: audio && audio.textContent,
      codec: el('codec') && el('codec').textContent,
      legacyPhase: phase && !phase.hidden ? phase.dataset.part : null,
      now: bar && bar.getAttribute('aria-valuenow'), indeterminate: !!bar && bar.classList.contains('is-indeterminate'),
      text: running && running.textContent};
  };
  window.__snapshotProcess = () => snapshot(app.exportState());
  app.bus.on('export', (s) => { if (s.phase === 'running') window.__processSnapshots.push(snapshot(s)); });
}"""
RESULT = r"""async () => {
  const state = window.__mv.exportState(), result = state.result;
  let parsed = null;
  if (result && (result.blob || window.__processFile)) {
    const blob = result.blob || await window.__processFile.getFile();
    const bytes = new Uint8Array(await blob.arrayBuffer()), read = async (at, n) => bytes.subarray(at, at + n);
    if (state.format === 'mp4' || state.format === 'webmAlpha') {
      const module = MV.use(state.format === 'mp4' ? 'media/isobmff' : 'media/matroska');
      const movie = await module.parse(read, bytes.length);
      parsed = movie.tracks.map((t) => ({kind: t.kind, codec: t.codec, frames: t.table && t.table.n, alpha: !!t.alpha}));
    } else parsed = {signature: [...bytes.slice(0, 4)], size: bytes.length};
  }
  return {phase: state.phase, message: state.message, result: result && {frames: result.frames, bytes: result.bytes,
    acceleration: result.acceleration, accelerationByOutput: result.accelerationByOutput, audioSource: result.audioSource,
    audioCodec: result.audioCodec, files: result.files && result.files.map(({kind}) => kind)}, parsed,
    encoders: window.__processEncoders.map((e) => ({...e.record, state: e.state})), audioJobs: window.__processAudio,
    sinks: window.__processSinks.map((s) => ({aborted: s.testAborted})), downloads: window.__processDownloads.length,
    snapshots: window.__processSnapshots};
}"""


async def open_test(browser, base, rel):
    page = await new_page(browser, viewport={'width': 1440, 'height': 1080})
    await page.add_init_script(INIT)
    for host in FONT_HOSTS:
        await page.route(host, lambda route: route.abort())
    await page.goto(base + rel + '?fresh=1&test=1', wait_until='load')
    await page.wait_for_function('() => window.__mv && window.__mv.ready')
    await page.evaluate('async () => { await window.__mv.ready; }')
    return page


async def setup(page, fmt='mp4', audio=False, local=False, acceleration='cpu', seconds=.25):
    await page.evaluate("""(text) => {
      const a = window.__mv; a.view.setPref('autoplay', false);
      a.dispatch({t: 'lyrics.set', text}, {label: ['undo.paste', {}]}); a.store.seal(); a.firstRun(); a.pause();
    }""", LYRICS)
    await page.wait_for_function('() => window.__mv.plan && window.__mv.plan.lines.length > 3', timeout=15000)
    if audio:
        assert await page.evaluate(SONG) == {'ready': True, 'rate': 48000, 'channels': 2}
    await page.evaluate("""({fmt, audio, local, acceleration, seconds}) => {
      const a = window.__mv; a.batch({label: ['undo.output', {}]}, [
        ...MV.use('ui/output').formatCmds(a.doc, fmt),
        {t: 'output.set', key: 'short', v: 720}, {t: 'output.set', key: 'fps', v: 24},
        {t: 'output.set', key: 'quality', v: 'light'}, {t: 'output.set', key: 'audio', v: audio},
        {t: 'output.set', key: 'audioEncoding', v: local ? 'local' : 'browser'},
        {t: 'output.set', key: 'acceleration', v: acceleration},
        {t: 'output.set', key: 'range', v: {t0: 1, t1: 1 + seconds}},
        ...(fmt === 'kit' ? [{t: 'output.set', key: 'kit', v: {overlay: true, bg: true, green: true, srt: true, lrc: true}}] : []),
      ]); a.store.seal(); a.goStep('export'); a.pause();
    }""", {'fmt': fmt, 'audio': audio, 'local': local, 'acceleration': acceleration, 'seconds': seconds})
    await page.wait_for_function('() => !!window.__mv.exportProbe()', timeout=15000)
    probe = await page.evaluate('() => window.__mv.exportProbe()')
    if fmt in ('mp4', 'kit'):
        assert probe['codec'], 'native H.264 encoding is required'
    if fmt in ('webmAlpha', 'kit'):
        assert probe['vp9Codec'], 'native VP9/VP8 encoding is required'
    await page.evaluate(SPIES)


def verify_process(result, fmt, lang):
    assert result['phase'] == 'done', result.get('message')
    snapshots = [s for s in result['snapshots'] if s.get('process', {}).get('stage')]
    assert snapshots, 'export has no live process events'
    stages = [s['process']['stage'] for s in snapshots]
    assert 'prepare' in stages and 'video' in stages and 'save' in stages, stages
    assert all(s['visible'] for s in snapshots), 'process details must be visible while exporting'
    for snap in snapshots:
        assert snap['stageText'] and snap['detail'] and snap['route'] and snap['gpuText'], snap
        assert 'exp.process.' not in snap['text'] and 'undefined' not in snap['text'], snap
        if snap['process']['stage'] in ('finalize', 'mux', 'files', 'zip', 'save', 'audioLoading', 'audioPrepare', 'audio'):
            assert snap['indeterminate'] and snap['now'] is None, snap
        if snap['process']['stage'] in ('finalize', 'mux', 'save'):
            assert snap['legacyPhase'] is None, snap
    assert all(e['state'] == 'closed' for e in result['encoders']), result['encoders']
    active = [e for e in result['encoders'] if e['frames']]
    video = [s for s in snapshots if s['process']['stage'] == 'video']
    assert video[0]['i'] == 0 and video[0]['N'] == result['result']['frames'], video[0]
    assert all(s['N'] == result['result']['frames'] for s in video), video
    if fmt in ('png', 'pngAlpha'):
        assert not active and all(s['process'].get('acceleration') is None for s in video), video
        assert all(s['gpu'] == 'not-video' for s in video), video
        assert 'zip' in stages and result['parsed']['signature'] == [80, 75, 3, 4]
    else:
        assert active and 'finalize' in stages and 'mux' in stages, stages
        assert all(s['gpuNote'] for s in video), 'actual GPU usage limitation must be visible'
        for snap in video:
            process = snap['process']
            if fmt == 'kit':
                selected = [item['acceleration']['selected'] for item in process['outputs']]
                actual = [e['selected'] for e in active]
                assert all(hint in actual for hint in selected), (selected, actual)
            else:
                assert process['acceleration']['selected'] == active[0]['selected'], (process, active)
                if fmt == 'webmAlpha':
                    assert process['acceleration']['alphaSelected'] == active[1]['selected'], (process, active)
        assert all(e['frames'] == result['result']['frames'] for e in active), result
        if fmt in ('mp4', 'webmAlpha'):
            track = next(t for t in result['parsed'] if t['kind'] == 'video')
            assert track['frames'] == result['result']['frames'], result
            assert track['alpha'] == (fmt == 'webmAlpha'), result
    return stages


async def run_success(page, fmt, lang, shots, name, hold=True):
    await page.evaluate('(hold) => { window.__holdFlush = hold; }', hold)
    await page.locator(START).click()
    if hold:
        await page.wait_for_function('() => window.__nativeFlushHeld || window.__mv.exportState().phase === "error"', timeout=120000)
        live = await page.evaluate('() => window.__snapshotProcess()')
        assert live['phase'] == 'running' and live['stage'] == 'finalize', live
        assert live['indeterminate'] and live['now'] is None, live
        if shots:
            await page.screenshot(path=str(shots / (lang + '_' + name + '_finalize.png')))
        await page.evaluate('() => window.__releaseFlush()')
    await page.wait_for_function('() => ["done", "error"].includes(window.__mv.exportState().phase)', timeout=180000)
    result = await page.evaluate(RESULT)
    if shots:
        (shots / (lang + '_' + name + '.json')).write_text(json.dumps(result, ensure_ascii=False))
    stages = verify_process(result, fmt, lang)
    return result, stages


async def flow_native(page, lang, shots):
    await setup(page, audio=True)
    result, stages = await run_success(page, 'mp4', lang, shots, 'mp4')
    assert result['audioJobs'] == 1 and result['result']['audioCodec'], result
    assert any(s['audio'] == 'browser' for s in result['snapshots']), result
    assert len([e for e in result['encoders'] if e['frames']]) == 1
    return stages


async def flow_fallback(page, lang, shots):
    await setup(page, acceleration='auto')
    await page.evaluate('() => { window.__quota = true; }')
    result, stages = await run_success(page, 'mp4', lang, shots, 'fallback')
    info = result['result']['acceleration']
    assert info == {'requested': 'auto', 'selected': 'no-preference', 'fallback': True}, info
    video = [s for s in result['snapshots'] if s.get('process', {}).get('stage') == 'video']
    assert all(s['gpu'] == 'fallback' for s in video), video
    assert any(e['failed'] for e in result['encoders']), result
    assert all(not e['frames'] for e in result['encoders'] if e['failed']), result
    return stages


async def flow_stream(page, lang, shots):
    await setup(page)
    await page.evaluate("""async () => {
      const ex = window.__mv.svc.exporter, original = MV.use('export/host/sink');
      const dir = await navigator.storage.getDirectory();
      window.__streamCloseHeld = false; window.__releaseStreamClose = null;
      ex.sink.openSink = async (o) => {
        const handle = await dir.getFileHandle(o.name, {create: true}); window.__processFile = handle;
        const sink = original.createFileSink(handle), close = sink.close;
        sink.close = async () => {
          window.__streamCloseHeld = true;
          await new Promise((resolve) => { window.__releaseStreamClose = resolve; });
          window.__streamCloseHeld = false; return close();
        };
        return sink;
      };
    }""")
    await page.locator(START).click()
    await page.wait_for_function('() => window.__streamCloseHeld || window.__mv.exportState().phase === "error"', timeout=30000)
    live = await page.evaluate('() => window.__snapshotProcess()')
    assert live['phase'] == 'running' and live['stage'] == 'save', live
    assert live['indeterminate'] and live['now'] is None, live
    if shots:
        await page.screenshot(path=str(shots / (lang + '_stream_save.png')))
    await page.evaluate('() => window.__releaseStreamClose()')
    await page.wait_for_function('() => ["done", "error"].includes(window.__mv.exportState().phase)', timeout=10000)
    result = await page.evaluate(RESULT)
    stages = verify_process(result, 'mp4', lang)
    assert result['downloads'] == 0 and result['result']['bytes'] > 0, result
    return stages


async def flow_png(page, lang, shots):
    await setup(page, fmt='pngAlpha')
    result, stages = await run_success(page, 'pngAlpha', lang, shots, 'png', hold=False)
    assert not result['encoders'] and result['audioJobs'] == 0, result
    return stages


async def flow_webm(page, lang, shots):
    await setup(page, fmt='webmAlpha', audio=True)
    result, stages = await run_success(page, 'webmAlpha', lang, shots, 'webm')
    assert 'audioPrepare' in stages and 'audio' in stages, stages
    assert stages.index('audio') < stages.index('video'), stages
    assert result['audioJobs'] == 1 and result['result']['audioCodec'] == 'opus', result
    assert len([e for e in result['encoders'] if e['frames']]) == 2, result
    return stages


async def flow_kit(page, lang, shots):
    await setup(page, fmt='kit')
    result, stages = await run_success(page, 'kit', lang, shots, 'kit')
    video = [s for s in result['snapshots'] if s.get('process', {}).get('stage') == 'video']
    kinds = [x['kind'] for x in video[-1]['process']['outputs']]
    assert kinds == ['main', 'overlay', 'bg', 'green'], kinds
    assert len([e for e in result['encoders'] if e['frames']]) == 5, result
    assert 'files' in stages and 'zip' in stages, stages
    assert result['parsed']['signature'] == [80, 75, 3, 4]
    return stages


async def flow_local(page, lang, shots):
    await setup(page, audio=True, local=True, seconds=1)
    result, stages = await run_success(page, 'mp4', lang, shots, 'local')
    assert 'audioLoading' in stages and 'audioPrepare' in stages and 'audio' in stages, stages
    assert stages.index('audioLoading') < stages.index('video') < stages.index('audioPrepare') < stages.index('audio'), stages
    audio = [s for s in result['snapshots'] if s.get('process', {}).get('stage') == 'audio']
    assert all(s['process']['backend'] == 'ffmpeg' and s['process']['videoCopy'] and s['audio'] == 'local' for s in audio), audio
    assert all(s['gpuNote'] for s in audio), audio
    assert result['audioJobs'] == 0 and result['result']['audioSource'] == 'local', result
    assert result['result']['audioCodec'] == 'mp4a.40.2', result
    assert len([e for e in result['encoders'] if e['frames']]) == 1, result
    return stages


async def flow_cancel(page, lang, shots):
    await setup(page, seconds=.5)
    await page.evaluate('() => { window.__holdFlush = true; }')
    await page.locator(START).click()
    await page.wait_for_function('() => window.__nativeFlushHeld', timeout=30000)
    await page.evaluate('() => { window.__mv.actions.run("export.cancel"); window.__releaseFlush(); }')
    await page.wait_for_function('() => window.__mv.exportState().phase === "idle"', timeout=10000)
    state = await page.evaluate(RESULT)
    assert state['downloads'] == 0 and state['sinks'][0]['aborted'], state
    assert all(e['state'] == 'closed' for e in state['encoders']), state
    assert not await page.locator('.exp-running').is_visible()
    await page.evaluate("""() => {
      const a = window.__mv; a.batch({label: ['undo.output', {}]}, [
        ...MV.use('ui/output').formatCmds(a.doc, 'png'),
        {t: 'output.set', key: 'range', v: {t0: 1, t1: 1.125}},
      ]); a.store.seal(); window.__processSnapshots = []; window.__processEncoders = [];
    }""")
    result, stages = await run_success(page, 'png', lang, shots, 'restart', hold=False)
    assert result['result']['frames'] == 3 and result['downloads'] == 1
    assert all(s['gpu'] == 'not-video' for s in result['snapshots'] if s.get('process', {}).get('stage') == 'video'), result
    return stages


async def flow_late_cancel(page, lang, shots, stream=False):
    await setup(page)
    await page.evaluate("""(stream) => {
      const ex = window.__mv.svc.exporter, open = ex.sink.openSink;
      window.__saveCloseHeld = false; window.__releaseSaveClose = null;
      ex.sink.openSink = async (o) => {
        let sink;
        if (stream) {
          const dir = await navigator.storage.getDirectory(), handle = await dir.getFileHandle(o.name, {create: true});
          window.__processFile = handle; sink = MV.use('export/host/sink').createFileSink(handle);
          const abort = sink.abort; sink.testAborted = false;
          sink.abort = async () => { sink.testAborted = true; return abort(); };
          window.__processSinks.push(sink);
        } else sink = await open(o);
        const close = sink.close;
        sink.close = async () => {
          window.__saveCloseHeld = true;
          await new Promise((resolve) => { window.__releaseSaveClose = resolve; });
          return close();
        };
        return sink;
      };
    }""", stream)
    await page.locator(START).click()
    await page.wait_for_function('() => window.__saveCloseHeld', timeout=30000)
    live = await page.evaluate('() => window.__snapshotProcess()')
    assert live['phase'] == 'running' and live['stage'] == 'save', live
    await page.evaluate('() => { window.__mv.actions.run("export.cancel"); window.__releaseSaveClose(); }')
    await page.wait_for_function('() => window.__mv.exportState().phase === "idle"', timeout=10000)
    result = await page.evaluate(RESULT)
    assert result['downloads'] == 0 and result['sinks'][0]['aborted'], result
    assert all(e['state'] == 'closed' for e in result['encoders']), result
    assert not await page.locator('.exp-running').is_visible()
    return [s['process']['stage'] for s in result['snapshots'] if s.get('process', {}).get('stage')]


async def flow_late_stream(page, lang, shots):
    return await flow_late_cancel(page, lang, shots, stream=True)


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--no-build', action='store_true')
    parser.add_argument('--only', choices=('native', 'fallback', 'stream', 'png', 'webm', 'kit', 'local', 'cancel', 'late_cancel', 'late_stream'))
    parser.add_argument('--skip', nargs='*', default=[])
    parser.add_argument('--shots', type=Path)
    args = parser.parse_args()
    if not args.no_build:
        ensure_built(args.root)
    if args.shots:
        args.shots.mkdir(parents=True, exist_ok=True)
    server = serve(args.root)
    failures, cases = [], 0
    try:
        async with async_playwright() as p:
            browser = await launch(p)
            try:
                for lang, rel in [('ja', 'index.html'), ('en', 'en/index.html')]:
                    for name, flow in [('native', flow_native), ('fallback', flow_fallback), ('stream', flow_stream), ('png', flow_png),
                                       ('webm', flow_webm), ('kit', flow_kit), ('local', flow_local), ('cancel', flow_cancel),
                                       ('late_cancel', flow_late_cancel), ('late_stream', flow_late_stream)]:
                        if args.only and args.only != name:
                            continue
                        if name in args.skip:
                            continue
                        page = await open_test(browser, 'http://127.0.0.1:%d/' % server.server_address[1], rel)
                        errors = []
                        page.on('pageerror', lambda e: errors.append(str(e)))
                        try:
                            stages = await flow(page, lang, args.shots)
                            assert not errors and not await page.evaluate('() => window.__csp'), errors
                            print(json.dumps({'lang': lang, 'flow': name, 'stages': list(dict.fromkeys(stages)), 'ok': True}), flush=True)
                        except Exception as error:
                            failures.append('%s/%s: %s' % (lang, name, error))
                            print('FAIL ' + failures[-1], flush=True)
                        finally:
                            cases += 1
                            await page.close()
            finally:
                await browser.close()
    finally:
        server.shutdown()
    print('export_process.py: %s (%d native JA/EN cases)' % ('FAILED' if failures else 'OK', cases), flush=True)
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
