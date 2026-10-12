#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Native Filmora export pipeline and optional before/after benchmark.

Every output snapshots its own rendered surface and waits at a shared frame boundary. Checks all native encoders'
timestamps, queue bounds, frame counts, source media barriers and cleanup after cancellation. Optional --before-page
compares encoded video/audio payloads and the other files with an earlier built page, excluding MP4 muxing dates,
while reporting wall-clock timings.
Timing is reported, not asserted: the host's encoder, GPU and concurrent work determine throughput.
Run: PW_EXECUTABLE=/usr/bin/chromium python3 tests/browser/export_speed.py [--root DIR] [--before-page /old.html]
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
from browser import launch  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402
from ui_flows import ensure_built, open_page, serve  # noqa: E402

EXPORT = r"""async ({project, cancel = false, simple = false}) => {
  const app = window.__mv, KIT = MV.use('export/host/kit'), SINK = MV.use('export/host/sink'), ISO = MV.use('media/isobmff');
  const MKV = MV.use('media/matroska'), S = MV.use('export/schedule'), file = JSON.parse(project);
  file.doc.output = Object.assign({}, file.doc.output, {short: 1080, fps: 30, quality: 'high', audio: true,
    range: {t0: 2, t1: 4}, kit: {overlay: true, bg: true, green: true, srt: true, lrc: true}});
  if (simple) file.doc.pins = Object.assign({}, file.doc.pins, {
    'work:filter.count': {v: 0, by: 'user'}, 'work:texture': {v: 'none', by: 'user'},
    'work:ground': {v: 'gridPaper', by: 'user'},
  });
  app.view.setPref('autoplay', false); app.store.load(file.doc, file.side); app.pause(); app.goStep('export');
  const doc = app.doc, original = window.VideoEncoder, encoders = [], ready = new Map(), notes = [];
  let nextJob = 0, prepareMs = 0, readyMs = 0, renderMs = 0, draws = 0, barrier = true;
  window.VideoEncoder = class extends original {
    constructor(init) { super(init); this.rec = {inputs: [], maxQueue: 0, config: null}; encoders.push(this); }
    configure(config) { this.rec.config = config; return super.configure(config); }
    encode(frame, opts) { this.rec.inputs.push({timestamp: frame.timestamp, duration: frame.duration, key: !!opts.keyFrame});
      super.encode(frame, opts); this.rec.maxQueue = Math.max(this.rec.maxQueue, this.encodeQueueSize); }
  };
  // Media calls remain serial and all jobs are ready before any output renders; rendering is synchronous.
  const wrap = (e) => { const id = nextJob++; return {
    fork: (o) => wrap(e.fork(o)), get plan() { return e.plan; }, setDoc: (d) => e.setDoc(d),
    async prepare(...args) { const t = performance.now(); await e.prepare(...args); prepareMs += performance.now() - t; },
    async mediaReady(t, o) { const start = performance.now(); await e.mediaReady(t, o); ready.set(id, t); readyMs += performance.now() - start; },
    renderFrame(surface, t, ropts) { for (const [job, at] of ready) if (job !== 0 && Math.abs(at - t) > 1e-8) barrier = false;
      const start = performance.now(), r = e.renderFrame(surface, t, ropts); renderMs += performance.now() - start; draws++; return r; },
    dispose: () => e.dispose(),
  }; };
  const source = app.engine.fork(); source.setDoc(doc); const engine = wrap(source);
  const song = new AudioBuffer({numberOfChannels: 2, length: 10 * 48000, sampleRate: 48000});
  for (let c = 0; c < 2; c++) { const data = song.getChannelData(c); for (let i = 0; i < data.length; i++) data[i] = .2 * Math.sin(i * Math.PI * 2 * (440 + 220 * c) / 48000); }
  const root = await navigator.storage.getDirectory(), folder = cancel ? 'export-speed-cancel' : 'export-speed-check';
  try { await root.removeEntry(folder, {recursive: true}); } catch (e) { /* first run */ }
  const handle = await root.getDirectoryHandle(folder, {create: true});
  const dir = SINK.createDirSink(handle, {parent: root, name: folder, owned: true}), ctl = new AbortController();
  try {
    const result = await KIT.exportKit({engine, doc, audio: song, dir, signal: ctl.signal,
      onProgress: (p) => { notes.push(p.i); if (cancel && p.i === 2) ctl.abort(); }});
    const files = [];
    for (const entry of result.files) {
      const blob = await (await handle.getFileHandle(entry.name)).getFile(), bytes = new Uint8Array(await blob.arrayBuffer());
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((x) => x.toString(16).padStart(2, '0')).join('');
      const item = {kind: entry.kind, bytes: entry.bytes, digest};
      const read = async (at, n) => bytes.subarray(at, at + n);
      if (['main', 'bg', 'green', 'overlay'].includes(entry.kind)) {
        const movie = entry.kind === 'overlay' ? await MKV.parse(read, bytes.length) : await ISO.parse(read, bytes.length);
        const video = movie.tracks.find((x) => x.kind === 'video');
        Object.assign(item, {frames: video.table.n, w: video.w, h: video.h, duration: video.table.duration,
          alpha: !!video.alpha, audio: movie.tracks.some((x) => x.kind === 'audio')});
        // MP4 headers carry the muxing date; compare encoded track bytes instead of those wall-clock metadata.
        if (entry.kind !== 'overlay') {
          const chunks = movie.tracks.flatMap((track) => Array.from(track.table.off, (off, k) => bytes.subarray(off, off + track.table.size[k])));
          const payload = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0)); let at = 0;
          for (const chunk of chunks) { payload.set(chunk, at); at += chunk.length; }
          item.digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', payload))).map((x) => x.toString(16).padStart(2, '0')).join('');
        }
      }
      files.push(item);
    }
    return {total: result.ms, prepare: prepareMs, ready: readyMs, render: renderMs, draws, frames: result.frames,
      barrier, files, encoders: encoders.map((e) => ({...e.rec, state: e.state})), notes};
  } catch (e) {
    let removed = false; try { await root.getDirectoryHandle(folder); } catch (x) { removed = x.name === 'NotFoundError'; }
    if (!cancel) throw e;
    return {error: e.code, removed, encoders: encoders.map((x) => ({state: x.state, frames: x.rec.inputs.length})), notes};
  } finally { window.VideoEncoder = original; source.dispose(); try { await root.removeEntry(folder, {recursive: true}); } catch (e) { /* cancellation removed it */ } }
}"""


def verify(result):
    assert result['frames'] == 60 and result['draws'] == 240, result
    assert result['barrier'], 'a source frame changed before every output had captured the preceding frame'
    assert len(result['encoders']) == 5, result['encoders']
    for enc in result['encoders']:
        assert enc['state'] == 'closed' and len(enc['inputs']) == 60, enc
        assert enc['maxQueue'] <= 7, enc['maxQueue']  # six queued frames at the barrier, plus the next input
        assert [i['timestamp'] for i in enc['inputs']] == [round(i * 1e6 / 30) for i in range(60)]
        assert enc['inputs'][0]['key'], enc
    for f in result['files']:
        if 'frames' in f:
            assert f['frames'] == 60 and [f['w'], f['h']] == [1920, 1080], f
            assert abs(f['duration'] - 2) < .002, f
    assert next(f for f in result['files'] if f['kind'] == 'overlay')['alpha']
    assert all(not f['audio'] for f in result['files'] if f['kind'] in ('bg', 'green', 'overlay'))


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--before-page', help='an earlier built page in root, e.g. /index-before.html')
    parser.add_argument('--runs', type=int, default=2, help='measured repeats per page after its first warm-up export')
    parser.add_argument('--simple', action='store_true', help='render a plain ground with screen effects and texture off')
    args = parser.parse_args()
    if args.runs < 1:
        parser.error('--runs must be positive')
    ensure_built(args.root)
    server = serve(args.root)
    all_results = {}
    try:
        async with async_playwright() as p:
            browser = await launch(p)
            pages = [args.before_page, '/index.html'] if args.before_page else ['/index.html']
            for rel in pages:
                page = await open_page(browser, 'http://127.0.0.1:' + str(server.server_address[1]), rel)
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                arg = {'project': (ROOT / 'tests/fixtures/project_basic.json').read_text(), 'simple': args.simple}
                results = []
                for run in range(args.runs + 1):
                    result = await page.evaluate(EXPORT, arg)
                    verify(result)
                    results.append(result)
                    print(json.dumps({'page': rel, 'run': run, 'warmup': run == 0, 'ms': result['total'],
                                      'prepare': result['prepare'], 'ready': result['ready'], 'render': result['render']}, ensure_ascii=False), flush=True)
                cancelled = await page.evaluate(EXPORT, dict(arg, cancel=True))
                assert cancelled['error'] == 'cancelled' and cancelled['removed'], cancelled
                assert all(e['state'] == 'closed' and e['frames'] == 2 for e in cancelled['encoders']), cancelled
                assert not errors and not await page.evaluate('window.__csp'), errors
                all_results[rel] = results
                await page.close()
            if args.before_page:
                old = all_results[args.before_page][-1]['files']
                new = all_results['/index.html'][-1]['files']
                assert old == new, 'independent output scheduling changed exported bytes: ' + repr([old, new])
                before = sum(r['total'] for r in all_results[args.before_page][1:]) / args.runs
                after = sum(r['total'] for r in all_results['/index.html'][1:]) / args.runs
                print(json.dumps({'before_ms': before, 'after_ms': after, 'ratio': after / before, 'identical_files': True}), flush=True)
            print('export_speed: passed — native frame timestamps, media barriers, queues, files and cancel cleanup')
            await browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    asyncio.run(main())
