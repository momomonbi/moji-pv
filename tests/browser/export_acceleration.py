#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Native device preferences and safe startup fallback, in ja/en.

GPU support is queried from the browser rather than inferred from hardwareConcurrency. MP4 and transparent WebM are
encoded with real native encoders, parsed, and decoded where their codec is supported. One startup-only quota failure
is injected to exercise fallback on machines without an available GPU encoder; subsequent frames still use WebCodecs.
Run: PW_EXECUTABLE=/usr/bin/chromium python3 tests/browser/export_acceleration.py [--root DIR]
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

EXPORT = r"""async ({project, mode, format, quota = false}) => {
  const app = window.__mv, J = MV.use('export/host/mp4'), WH = MV.use('export/host/webm'), SINK = MV.use('export/host/sink');
  const S = MV.use('export/schedule'), ISO = MV.use('media/isobmff'), MKV = MV.use('media/matroska');
  const doc = JSON.parse(project).doc;
  Object.assign(doc.output, {short: 720, fps: 30, audio: false, acceleration: mode, quality: 'standard', range: {t0: 2, t1: 2.2}});
  const original = window.VideoEncoder, encoders = [], queries = [];
  window.VideoEncoder = class extends original {
    static async isConfigSupported(config) {
      queries.push({codec: config.codec, hint: config.hardwareAcceleration});
      if (quota && config.hardwareAcceleration === 'prefer-hardware') {
        const supported = await original.isConfigSupported({...config, hardwareAcceleration: 'no-preference'});
        return {...supported, config: {...supported.config, hardwareAcceleration: 'prefer-hardware'}};
      }
      return original.isConfigSupported(config);
    }
    constructor(init) { super(init); this.rec = {frames: [], hint: null}; encoders.push(this); }
    configure(config) {
      this.rec.hint = config.hardwareAcceleration;
      if (quota && config.hardwareAcceleration === 'prefer-hardware') throw new DOMException('GPU encoder occupied', 'QuotaExceededError');
      return super.configure(config);
    }
    encode(frame, opts) { this.rec.frames.push({timestamp: frame.timestamp, duration: frame.duration, key: !!opts.keyFrame}); return super.encode(frame, opts); }
  };
  const engine = app.engine.fork(); engine.setDoc(doc);
  try {
    const probe = await J.probe({w: 1280, h: 720, fps: 30, acceleration: mode});
    const isWebm = format === 'webm';
    const codec = isWebm ? probe.vp9Codec : probe.codec;
    if (!codec) return {skip: format, probe};
    const result = await (isWebm ? WH.exportWebm : J.exportVideo)({engine, doc, sink: SINK.createMemorySink({name: 'acceleration.' + format})});
    const bytes = new Uint8Array(await result.blob.arrayBuffer()), read = async (at, n) => bytes.subarray(at, at + n);
    const movie = await (isWebm ? MKV.parse(read, bytes.length) : ISO.parse(read, bytes.length));
    const video = movie.tracks.find((x) => x.kind === 'video');
    const decoded = [], decodeErrors = [];
    for (const alpha of isWebm ? [false, true] : [false]) {
      let count = 0;
      const decoder = new VideoDecoder({output: (f) => { count++; f.close(); }, error: (e) => decodeErrors.push(String(e))});
      try {
        const config = {codec: video.codec, codedWidth: video.codedW || video.w, codedHeight: video.codedH || video.h};
        if (video.description) config.description = video.description;
        decoder.configure(config);
        const table = video.table, off = alpha ? table.aoff : table.off, size = alpha ? table.asize : table.size;
        for (let d = 0; d < table.key.length; d++) decoder.decode(new EncodedVideoChunk({type: table.key[d] ? 'key' : 'delta',
          timestamp: Math.round(table.ts[d]), data: bytes.subarray(off[d], off[d] + size[d])}));
        await decoder.flush(); decoded.push(count);
      } finally { if (decoder.state !== 'closed') decoder.close(); }
    }
    return {probe, result: {frames: result.frames, codec: result.codec, acceleration: result.acceleration},
      parsed: {frames: video.table.n, w: video.w, h: video.h, alpha: !!video.alpha, duration: video.table.duration},
      decoded, decodeErrors, encoders: encoders.map((e) => ({...e.rec, state: e.state})), queries};
  } finally { window.VideoEncoder = original; engine.dispose(); }
}"""


def verify(result, mode, format, quota):
    if result.get('skip'):
        return False
    assert result['result']['frames'] == 6 and result['parsed']['frames'] == 6, result
    assert [result['parsed']['w'], result['parsed']['h']] == [1280, 720], result
    assert abs(result['parsed']['duration'] - .2) < .002, result
    assert result['decoded'] == ([6, 6] if format == 'webm' else [6]) and not result['decodeErrors'], result
    info = result['result']['acceleration']
    assert info['requested'] == mode, info
    requested = 'prefer-software' if mode == 'cpu' else 'prefer-hardware'
    assert info['selected'] in (requested, 'no-preference'), info
    assert info['fallback'] == (info['selected'] != requested), info
    if quota:
        assert info['selected'] == 'no-preference' and info['fallback'], info
        assert all(not e['frames'] for e in result['encoders'] if e['hint'] == 'prefer-hardware'), result
    assert all(e['state'] == 'closed' for e in result['encoders']), result
    active = [e for e in result['encoders'] if e['frames']]
    assert len(active) == (2 if format == 'webm' else 1), result
    for e in active:
        assert [f['timestamp'] for f in e['frames']] == [0, 33333, 66667, 100000, 133333, 166667], e
        assert e['frames'][0]['key'], e
    if format == 'webm':
        assert result['parsed']['alpha'], result
        assert info['alphaSelected'] in (requested, 'no-preference'), info
    else:
        assert not result['parsed']['alpha'], result
    return True


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args()
    ensure_built(args.root)
    server = serve(args.root)
    count = 0
    try:
        async with async_playwright() as p:
            browser = await launch(p)
            for lang, path in [('ja', '/index.html'), ('en', '/en/index.html')]:
                page = await open_page(browser, 'http://127.0.0.1:' + str(server.server_address[1]), path)
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                for format in ['mp4', 'webm']:
                    for mode, quota in [('auto', False), ('cpu', False), ('auto', True)]:
                        result = await page.evaluate(EXPORT, {'project': (ROOT / 'tests/fixtures/project_basic.json').read_text(),
                                                             'mode': mode, 'format': format, 'quota': quota})
                        checked = verify(result, mode, format, quota)
                        count += checked
                        print(json.dumps({'lang': lang, 'format': format, 'mode': mode, 'quota': quota,
                                          'acceleration': result.get('result', {}).get('acceleration'), 'checked': checked}), flush=True)
                assert not errors and not await page.evaluate('window.__csp'), errors
                await page.close()
            await browser.close()
        assert count >= 6, 'no native video codec was checked'
        print('export_acceleration: passed — %d native MP4/WebM cases, preference/fallback, exact frames and cleanup' % count)
    finally:
        server.shutdown()


if __name__ == '__main__':
    asyncio.run(main())
