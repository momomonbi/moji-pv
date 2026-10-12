#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Export quality in the real JA/EN UI.

Checks live size estimates (resolution, fps, range, sound, transparent video), negotiated audio targets and actual MP4
audio bytes, PNG's lossless note, and four actual three-second comparison clips for MP4 and transparent WebM.
The clips use the production engine and exporter: inspect
their sample tables, decode their video in the page, compare it with the committed scene while a different look is
being tried on, and verify synchronized playback, a wide dialog, cancellation, stale-clip disposal and unchanged
export/undo state. Native WebM alpha keeps clear corners and opaque/antialiased glyphs at each quality.

Native H.264 is used where available. As in export_check.py, Chromium without proprietary codecs uses VP9 in MP4 for
the test only; MV_REQUIRE_H264=1 makes the missing H.264 encoder a failure. Nothing is downloaded by the comparison.
Run: PW_EXECUTABLE=/usr/bin/chromium python3 tests/browser/export_quality.py [--flow settings|comparison|webm|audio] [--shots DIR]
"""
import argparse
import asyncio
import math
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
from browser import launch  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402
from ui_flows import AI_WAV_JS, DOC, DONE, Flow, ensure_built, open_page, serve, with_lyrics  # noqa: E402

QUALITIES = ('light', 'standard', 'high', 'max')
BPP = (0.04, 0.08, 0.12, 0.18)
GROUP = '[data-seg="quality"]'
PREVIEW = '.export-quality-preview'
START = '[data-act="quality-preview.start"]'
REQUIRE_H264 = os.environ.get('MV_REQUIRE_H264') == '1'

CARDS = r"""() => [...document.querySelectorAll('[data-seg="quality"] [data-v]')].map((el) => ({
  quality: el.dataset.v, checked: el.getAttribute('aria-checked'), text: el.textContent,
  title: el.querySelector('.quality-option-title').textContent,
  bytes: Number(el.querySelector('[data-quality-bytes]').dataset.qualityBytes),
  estimate: el.querySelector('[data-quality-bytes]').textContent,
  ratio: el.querySelector('[data-quality-ratio]').textContent,
  description: el.querySelector('[data-quality-description]').textContent,
  more: !!el.closest('details'),
}))"""
OBSERVE = r"""async () => {
  const a = window.__mv, ex = a.svc.exporter, original = ex.mp4, S = MV.use('export/schedule');
  window.__qualityCalls = []; window.__qualityDownloads = []; window.__qualityRevoked = [];
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = (url) => { window.__qualityRevoked.push(url); revoke(url); };
  ex.sink = Object.assign({}, ex.sink, { downloadBlob: (...args) => { window.__qualityDownloads.push(args[1]); } });
  const probe = await original.probe({ w: 1280, h: 720, fps: 24 });
  const h264 = !!probe.codec;
  const withCodec = (o) => h264 ? o : Object.assign({}, o, {
    codecs: Object.assign({}, o.codecs, { video: S.pickVp9(1280, 720, o.doc.output.fps)[0] }),
  });
  ex.mp4 = Object.assign({}, original, {
    probe: async (o) => {
      const p = await original.probe(o);
      return h264 ? p : Object.assign({}, p, { codec: S.pickVp9(o.w, o.h, o.fps)[0], anyCodec: true });
    },
    exportVideo: async (o) => {
      const call = { quality: o.doc.output.quality, short: o.doc.output.short, fps: o.doc.output.fps,
        range: o.doc.output.range, format: o.doc.output.format, sound: o.doc.output.audio,
        audio: !!o.audio, primary: o.engine === a.engine,
        content: JSON.stringify({ look: o.doc.look, pins: o.doc.pins, sheet: o.doc.sheet }), done: false };
      window.__qualityCalls.push(call);
      try {
        const r = await original.exportVideo(withCodec(o));
        call.done = true; call.frames = r.frames; call.bytes = r.bytes; call.codec = r.codec; call.blob = r.blob;
        return r;
      } catch (e) { call.error = e.code || e.name; throw e; }
    },
  });
  const webm = ex.webm;
  ex.webm = Object.assign({}, webm, { exportWebm: async (o) => {
    const call = { quality: o.doc.output.quality, short: o.doc.output.short, fps: o.doc.output.fps,
      range: o.doc.output.range, format: o.doc.output.format, sound: o.doc.output.audio,
      audio: !!o.audio, primary: o.engine === a.engine, done: false, type: 'webm' };
    window.__qualityCalls.push(call);
    try { const r = await webm.exportWebm(o); call.done = true; call.frames = r.frames;
      call.bytes = r.bytes; call.codec = r.codec; call.blob = r.blob; return r;
    } catch (e) { call.error = e.code || e.name; throw e; }
  } });
  return { h264, audioCodec: probe.audioCodec, audioBitrate: probe.audioBitrate };
}"""
CLIPS = r"""() => [...document.querySelectorAll('[data-preview-quality]')].map((el) => {
  const v = el.querySelector('video'); return { quality: el.dataset.previewQuality, url: v.currentSrc || v.src,
    w: v.videoWidth, h: v.videoHeight, duration: v.duration, muted: v.muted, controls: v.controls,
    text: el.textContent, paused: v.paused, time: v.currentTime };
})"""
MP4_TABLES = r"""async () => {
  const parser = MV.use('media/isobmff'); const out = [];
  for (const call of window.__qualityCalls.filter((c) => c.done)) {
    const blob = call.blob;
    const movie = await parser.parse(async (at, n) => new Uint8Array(await blob.slice(at, at + n).arrayBuffer()), blob.size);
    const v = movie.tracks.find((t) => t.kind === 'video');
    out.push({ quality: call.quality, bytes: blob.size, w: v.w, h: v.h, fps: v.table.fps, frames: v.table.n,
      duration: v.table.duration, audio: movie.tracks.some((t) => t.kind === 'audio') });
  }
  return out;
}"""
WEBM_TABLES = r"""async () => {
  const parser = MV.use('media/matroska'); const out = [];
  for (const call of window.__qualityCalls.filter((c) => c.done && c.type === 'webm')) {
    const blob = call.blob;
    const movie = await parser.parse(async (at, n) => new Uint8Array(await blob.slice(at, at + n).arrayBuffer()), blob.size);
    const v = movie.tracks.find((t) => t.kind === 'video');
    out.push({ quality: call.quality, bytes: blob.size, type: blob.type, w: v.w, h: v.h, fps: v.table.fps,
      frames: v.table.n, duration: v.table.duration, alpha: v.alpha,
      alphaFrames: v.table.asize && [...v.table.asize].filter((n) => n > 0).length,
      audio: movie.tracks.some((t) => t.kind === 'audio') });
  }
  return out;
}"""
PIXELS = r"""async ({ relative, source, alpha = false }) => {
  const videos = [...document.querySelectorAll('[data-preview-quality] video')];
  const waitSeek = (v, t) => new Promise((resolve, reject) => {
    if (Math.abs(v.currentTime - t) < 0.0001 && v.readyState >= 2 && !v.seeking) { resolve(); return; }
    let timer;
    const done = () => { clearTimeout(timer); v.removeEventListener('seeked', done); resolve(); };
    timer = setTimeout(() => { v.removeEventListener('seeked', done); reject(new Error('clip seek timed out')); }, 7000);
    v.pause(); v.addEventListener('seeked', done); v.currentTime = t;
  });
  const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = (image) => { ctx.clearRect(0, 0, 160, 90); ctx.drawImage(image, 0, 0, 160, 90);
    return ctx.getImageData(0, 0, 160, 90).data; };
  const engine = window.__mv.engine.fork();
  engine.setDoc(window.__mv.doc);
  const surface = { canvas, ctx, w: 160, h: 90 };
  await engine.prepare(source, source + 1 / 24, { export: true });
  await engine.mediaReady(source, { fps: 24 });
  engine.renderFrame(surface, source, { quality: 'export', backdrop: alpha ? 'clear' : 'scene' });
  const reference = ctx.getImageData(0, 0, 160, 90).data.slice(); engine.dispose();
  const results = [];
  for (const video of videos) {
    await waitSeek(video, relative);
    const pixels = data(video); let error = 0, min = 255, max = 0, hash = 2166136261;
    let alphaError = 0, clear = 0, opaque = 0, partial = 0, opaqueError = 0, comparable = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      min = Math.min(min, pixels[i], pixels[i + 1], pixels[i + 2]);
      max = Math.max(max, pixels[i], pixels[i + 1], pixels[i + 2]);
      alphaError += Math.abs(pixels[i + 3] - reference[i + 3]);
      if (pixels[i + 3] < 4) clear++;
      else if (pixels[i + 3] > 250) opaque++;
      else partial++;
      for (let c = 0; c < 3; c++) { error += Math.abs(pixels[i + c] - reference[i + c]);
        if (pixels[i + 3] > 240 && reference[i + 3] > 240) {
          opaqueError += Math.abs(pixels[i + c] - reference[i + c]); comparable++;
        }
        hash = Math.imul(hash ^ pixels[i + c], 16777619); }
    }
    results.push({ error: error / (160 * 90 * 3), contrast: max - min, hash: hash >>> 0,
      alphaError: alphaError / (160 * 90), clear, opaque, partial,
      opaqueError: comparable ? opaqueError / comparable : null,
      corners: [0, 159, 160 * 89, 160 * 90 - 1].map((p) => pixels[p * 4 + 3]),
    });
  }
  return results;
}"""


async def setup(f, song=False):
    await with_lyrics(f)
    if song:
        await f.page.evaluate(AI_WAV_JS)
        f.check(await f.page.evaluate("async () => { await window.__mv.loadSong(window.__wav(24, 'quality.wav')); return window.__mv.songReady(); }"),
                'test song decoded')
    await f.page.evaluate("""() => {
      const a = window.__mv; a.batch({ label: ['undo.output', {}] }, [
        { t: 'output.set', key: 'short', v: 720 }, { t: 'output.set', key: 'fps', v: 30 },
        { t: 'output.set', key: 'range', v: { t0: 1, t1: 11 } },
      ]); a.store.seal(); a.goStep('export'); a.pause();
    }""")
    await f.until('() => !!window.__mv.exportProbe()', 'export codecs probed', timeout=15000)
    await f.settle()


async def cards(f, w, h, fps, seconds, rate=0, alpha=False):
    got = await f.page.evaluate(CARDS)
    expected = [math.ceil(seconds * (round(w * h * fps * bpp) * (2 if alpha else 1) + rate) / 8 * 1.02) for bpp in BPP]
    f.check([c['quality'] for c in got] == list(QUALITIES), 'all four quality choices are shown')
    f.check([c['bytes'] for c in got] == expected, 'estimates track current size/fps/range/sound: %r vs %r' % ([c['bytes'] for c in got], expected))
    f.check(all(c['estimate'] and c['ratio'] and c['description'] for c in got), 'each quality explains size, ratio and visual tradeoff')
    f.check(all(c['title'] and 'exp.' not in c['title'] and 'exp.' not in c['description'] for c in got),
            'all four quality names and descriptions are translated')
    f.check(not any(c['more'] for c in got), 'quality choices are visible outside collapsed details')
    f.check(len({c['description'] for c in got}) == 4, 'quality descriptions distinguish the visual tradeoffs')
    f.check(got[0]['bytes'] < got[1]['bytes'], 'light quality estimates less than standard')
    if rate:
        f.check(got[0]['bytes'] > got[1]['bytes'] * 0.5, 'light reduces video bitrate while retaining full-rate audio')
    else:
        f.check(abs(got[0]['bytes'] - got[1]['bytes'] * 0.5) <= 1, 'silent light video is about half of standard')
        f.check('0.50' in got[0]['ratio'] and '1.00' in got[1]['ratio'], 'quality ratios use standard as their base')
    return got


async def flow_settings(f, lang):
    page = f.page
    await setup(f, song=True)
    pr = await page.evaluate('() => window.__mv.exportProbe()')
    rate = pr['audioBitrate'] or 0
    f.check(rate == 320000 or rate in (192000, 160000), 'native audio chooses 320 kbps or a declared compatibility target')
    await cards(f, 1280, 720, 30, 10, rate)
    await page.locator(GROUP + ' [data-v="light"]').click()
    f.check(await page.evaluate('() => window.__mv.doc.output.quality') == 'light', 'lowest quality can be selected')
    note = await page.locator('[data-note="audio-quality"]').inner_text()
    f.check(str(rate // 1000) in note, 'audio note reports the negotiated target: ' + note)
    await page.locator('[data-ctl="size"] select').select_option('1080')
    await f.until('() => !!window.__mv.exportProbe()', 'larger size probed', timeout=15000)
    await cards(f, 1920, 1080, 30, 10, rate)
    await page.locator('[data-seg="fps"] [data-v="60"]').click()
    await f.until('() => !!window.__mv.exportProbe()', '60 fps probed', timeout=15000)
    await cards(f, 1920, 1080, 60, 10, rate)
    await page.evaluate("() => window.__mv.dispatch({ t: 'output.set', key: 'range', v: { t0: 1, t1: 6 } }, { label: ['undo.output', {}] })")
    await cards(f, 1920, 1080, 60, 5, rate)
    await page.locator('[data-ctl="more"] summary').click()
    await page.locator('#exp-audio').uncheck()
    await cards(f, 1920, 1080, 60, 5)
    await page.locator('#exp-audio').check()
    # The UI must name an actual encoder limit, rather than continuing to promise 320 kbps.
    await page.evaluate("""() => { const a = window.__mv; window.__nativeExportProbe = a.exportProbe;
      const native = a.exportProbe(); a.exportProbe = () => Object.assign({}, native, {
        audioCodec: 'mp4a.40.2', audioBitrate: 192000, webmAudioCodec: 'opus', webmAudioBitrate: 320000,
      }); a.bus.emit('export', a.exportState()); }""")
    await cards(f, 1920, 1080, 60, 5, 192000)
    note = await page.locator('[data-note="audio-quality"]').inner_text()
    f.check('192' in note and 'AAC' in note and '320' in note, 'AAC fallback says actual 192 kbps and preferred 320 kbps: ' + note)
    await page.locator('[data-other="format"]').select_option('webmAlpha')
    await cards(f, 1920, 1080, 60, 5, 320000, alpha=True)
    note = await page.locator('[data-note="audio-quality"]').inner_text()
    f.check('320' in note and 'Opus' in note and '192' not in note, 'WebM reports its own Opus target: ' + note)
    for fmt in ('png', 'pngAlpha'):
        await page.locator('[data-other="format"]').select_option(fmt)
        f.check(not await page.locator(GROUP).is_visible(), fmt + ': video quality choices are hidden')
        lossless = page.locator('[data-note="quality-lossless"]')
        f.check(await lossless.is_visible() and bool(await lossless.inner_text()), fmt + ': lossless PNG explanation is visible')
        f.check(not await page.locator(START).is_enabled(), fmt + ': encoded comparison cannot start')
    await f.shot('lossless')


async def flow_comparison(f, lang):
    page = f.page
    await setup(f)
    await page.evaluate("""() => {
      const a = window.__mv; a.dispatch({ t: 'output.set', key: 'fps', v: 24 }, { label: ['undo.output', {}] });
      a.store.seal(); a.seek(3); const trial = Object.assign({}, a.doc, {
        look: Object.assign({}, a.doc.look, { seed: a.doc.look.seed + 1000 }),
      }); a.tryOn(trial, 'quality regression');
      window.__qualityContent = JSON.stringify({ look: a.doc.look, pins: a.doc.pins, sheet: a.doc.sheet });
      window.__qualityPrimaryPlan = JSON.stringify(a.engine.plan);
    }""")
    cap = await page.evaluate(OBSERVE)
    if REQUIRE_H264 and not cap['h264']:
        f.check(False, 'MV_REQUIRE_H264: H.264 must encode')
        return
    print('info  %s comparison codec: %s' % (lang, 'native H.264' if cap['h264'] else 'VP9 in MP4 (test override)'))
    doc0, done0 = await page.evaluate(DOC), await page.evaluate(DONE)
    await page.locator(START).click()
    await page.evaluate("() => { window.__qualityPreviewRoot = document.querySelector('.export-quality-preview'); }")
    await f.until("() => document.querySelector('.export-quality-preview').dataset.previewPhase === 'done'", 'four real comparison clips complete', timeout=120000)
    await f.until("() => [...document.querySelectorAll('[data-preview-quality] video')].length === 4 && [...document.querySelectorAll('[data-preview-quality] video')].every((v) => v.readyState >= 2)",
                  'all four clips decode', timeout=20000)
    clips = await page.evaluate(CLIPS)
    f.check([c['quality'] for c in clips] == list(QUALITIES), 'four clips retain quality order')
    f.check(all((c['w'], c['h']) == (1280, 720) and abs(c['duration'] - 3) < 0.05 for c in clips), 'comparison uses chosen resolution and exactly three seconds')
    f.check(all(c['muted'] and c['controls'] for c in clips), 'actual clips are muted and can play in place')
    calls = await page.evaluate("() => window.__qualityCalls.map(({ blob, ...rest }) => rest)")
    f.check(len(calls) == 4 and all(c['done'] and c['frames'] == 72 and c['fps'] == 24 for c in calls), 'each selected-fps clip encoded 72 frames')
    f.check(calls[0]['quality'] == 'light' and calls[0]['bytes'] < calls[1]['bytes'], 'actual light clip uses less space than standard')
    f.check(all(c['range'] == {'t0': 3, 't1': 6} and c['format'] == 'mp4' and not c['sound'] and not c['audio'] for c in calls), 'all qualities compare the same range without song encoding')
    content = await page.evaluate('() => window.__qualityContent')
    f.check(all(not c['primary'] and c['content'] == content for c in calls), 'all qualities render a committed snapshot during try-on')
    tables = await page.evaluate(MP4_TABLES)
    f.check(all(t['frames'] == 72 and abs(t['duration'] - 3) < 1e-6 and not t['audio'] for t in tables), 'actual MP4 sample tables confirm 72 frames, three seconds and no sound')
    # The same native players move into a wide comparison; opening it must not encode again or replace their URLs.
    await page.locator('[data-act="quality-preview.expand"]').click()
    await f.until("() => !!document.querySelector('dialog[open]')", 'wide comparison dialog opens')
    wide = await page.evaluate("""() => [...document.querySelectorAll('dialog[open] [data-preview-quality] video')].map((v) => {
      const r = v.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, url: v.currentSrc || v.src }; })""")
    f.check(len(wide) == 4 and wide[0]['x'] < wide[1]['x'] < wide[2]['x'] < wide[3]['x'] and
            max(c['y'] for c in wide) - min(c['y'] for c in wide) < 10 and min(c['w'] for c in wide) > 200,
            'wide dialog presents four large clips side by side')
    f.check([c['url'] for c in wide] == [c['url'] for c in clips], 'wide comparison reuses the exact clips')
    main_at = await page.evaluate('() => window.__mv.view.state.time')
    await page.locator('dialog[open] [data-act="quality-preview.play"]').focus()
    await page.keyboard.press('Space')
    await f.until("() => [...document.querySelectorAll('dialog[open] video')].every((v) => !v.paused)", 'dialog Space plays all local clips')
    f.check(await page.evaluate('(t) => !window.__mv.view.state.playing && window.__mv.view.state.time === t', main_at),
            'dialog keys do not start or seek the project transport')
    await f.shot('wide_comparison')
    await page.keyboard.press('Space')
    await page.keyboard.press('Escape')
    await f.until("() => !document.querySelector('dialog[open]')", 'Escape closes comparison dialog')
    f.check(await page.evaluate("() => document.activeElement.matches('[data-act=\"quality-preview.expand\"]')"), 'dialog returns focus to expand control')
    f.check([c['url'] for c in await page.evaluate(CLIPS)] == [c['url'] for c in clips] and
            await page.evaluate('() => window.__qualityCalls.length') == 4, 'closing dialog restores original players without re-encoding')
    f.check(await page.evaluate(DOC) == doc0 and await page.evaluate(DONE) == done0, 'comparison does not change document or undo history')
    f.check(await page.evaluate('() => JSON.stringify(window.__mv.engine.plan) === window.__qualityPrimaryPlan && window.__mv.shell.stage.hasAlt()'), 'comparison leaves the tried look and primary engine intact')
    f.check(await page.evaluate('() => window.__mv.exportState().phase') == 'idle', 'comparison leaves full-export state idle')
    first = await page.evaluate(PIXELS, {'relative': 0.75, 'source': 3.75})
    later = await page.evaluate(PIXELS, {'relative': 1.75, 'source': 4.75})
    f.check(all(x['contrast'] > 20 and x['error'] < 20 for x in first + later), 'decoded comparison shows committed scene content, not a blank or stale preview: %r' % (first + later))
    f.check(all(a['hash'] != b['hash'] for a, b in zip(first, later)), 'each encoded clip visibly moves over time')
    await page.locator('[data-act="quality-preview.play"]').click()
    await f.until("() => [...document.querySelectorAll('[data-preview-quality] video')].every((v) => !v.paused)", 'all qualities play in place together')
    await page.wait_for_timeout(180)
    moving = await page.evaluate(CLIPS)
    f.check(max(c['time'] for c in moving) - min(c['time'] for c in moving) < 0.18, 'comparison playback stays synchronized')
    urls = [c['url'] for c in clips]
    await page.evaluate("() => { window.__qualityVideos = [...document.querySelectorAll('[data-preview-quality] video')]; }")
    await page.evaluate("() => window.__mv.goStep('look')")
    await f.settle(3)
    f.check(await page.evaluate('() => window.__qualityVideos.length === 4 && window.__qualityVideos.every((v) => v.paused)'),
            'leaving export pauses all local comparison videos')
    await page.evaluate("() => window.__mv.goStep('export')")
    f.check([c['url'] for c in await page.evaluate(CLIPS)] == urls, 'returning to export retains completed clips')
    main_time = await page.evaluate('() => window.__mv.view.state.time')
    local_seek = page.locator('[data-quality-preview-seek]')
    await local_seek.focus()
    for key in ('ArrowRight', 'Home', 'End'):
        await page.keyboard.press(key)
    f.check(await page.evaluate('() => window.__mv.view.state.time') == main_time,
            'comparison seek keys do not move the main project playhead')
    await page.locator('[data-act="quality-preview.play"]').focus()
    await page.keyboard.press('Space')
    await f.settle(3)
    f.check(await page.evaluate('(t) => !window.__mv.view.state.playing && window.__mv.view.state.time === t', main_time),
            'comparison Space starts only local clips, not the project transport')
    await page.keyboard.press('Space')
    await page.locator(GROUP + ' [data-v="max"]').click()
    f.check([c['url'] for c in await page.evaluate(CLIPS)] == urls, 'choosing a quality retains already encoded comparison clips')
    f.check(await page.evaluate(DONE) == done0 + 1 and await page.evaluate('() => window.__mv.doc.output.quality') == 'max', 'explicit quality choice is one undo entry')
    await f.shot('comparison')
    await page.locator('[data-seg="fps"] [data-v="30"]').click()
    await f.until("() => document.querySelector('.export-quality-preview').dataset.previewPhase === 'idle'", 'fps change invalidates comparison')
    f.check(await page.locator('[data-preview-quality] video').count() == 0, 'stale clips are removed')
    f.check(await page.evaluate('(urls) => urls.every((url) => window.__qualityRevoked.includes(url))', urls), 'all stale object URLs are released')
    # Start native encoding again and cancel while it is running; this never becomes the main export.
    await page.locator(START).click()
    await f.until("() => document.querySelector('.export-quality-preview').dataset.previewPhase === 'running'", 'comparison running')
    await page.locator('[data-act="quality-preview.cancel"]').click()
    await f.until("() => document.querySelector('.export-quality-preview').dataset.previewPhase === 'idle'", 'cancelled comparison settles', timeout=30000)
    f.check(await page.locator('[data-preview-quality] video').count() == 0, 'cancel leaves no incomplete comparison')
    await page.locator(START).click()
    await f.until("() => document.querySelector('.export-quality-preview').dataset.previewPhase === 'running'", 'comparison restarted')
    await page.evaluate("() => window.__mv.goStep('look')")
    await f.until("() => window.__qualityPreviewRoot.dataset.previewPhase === 'idle'", 'leaving export cancels unfinished comparison', timeout=30000)
    await page.evaluate("() => window.__mv.goStep('export')")
    f.check(await page.locator('[data-preview-quality] video').count() == 0, 'leaving during encoding keeps no unfinished clip')
    f.check(await page.evaluate('() => window.__qualityDownloads.length === 0 && window.__mv.exportState().phase === "idle" && !window.__mv.exporting'),
            'comparison and cancellation download nothing and leave main export idle')


async def flow_audio(f, lang):
    page = f.page
    await setup(f, song=True)
    cap = await page.evaluate(OBSERVE)
    if REQUIRE_H264 and not cap['h264']:
        f.check(False, 'MV_REQUIRE_H264: H.264 must encode')
        return
    doc0, done0 = await page.evaluate(DOC), await page.evaluate(DONE)
    result = await page.evaluate(r"""async () => {
      const a = window.__mv, ex = a.svc.exporter, probe = await ex.mp4.probe({ w: 1280, h: 720, fps: 30 });
      let preferred = false;
      if (probe.audioCodec) for (const mode of ['constant', null]) try {
        const config = { codec: probe.audioCodec, sampleRate: 48000, numberOfChannels: 2, bitrate: 320000 };
        if (mode) config.bitrateMode = mode;
        const supported = await AudioEncoder.isConfigSupported(config);
        if (supported.supported && supported.config.bitrate === 320000) preferred = true;
      } catch (e) { /* codec not available at the preferred target */ }
      const doc = Object.assign({}, a.doc, { output: Object.assign({}, a.doc.output,
        { format: 'mp4', short: 720, fps: 30, quality: 'light', audio: true, range: { t0: 2, t1: 4 } }) });
      const sink = ex.sink.createMemorySink({ type: 'video/mp4' });
      const r = await ex.mp4.exportVideo({ engine: a.engine, doc, audio: a.buffer, sink });
      const bytes = new Uint8Array(await r.blob.arrayBuffer()), view = new DataView(bytes.buffer);
      const boxes = (from, to) => { const out = []; for (let at = from; at + 8 <= to;) {
        let size = view.getUint32(at), head = 8;
        if (size === 1) { size = view.getUint32(at + 8) * 4294967296 + view.getUint32(at + 12); head = 16; }
        else if (!size) size = to - at;
        out.push({ type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)), body: at + head, end: at + size });
        at += size;
      } return out; };
      const child = (box, type) => boxes(box.body, box.end).find((b) => b.type === type);
      const moov = boxes(0, bytes.length).find((b) => b.type === 'moov'); let audio = null;
      for (const trak of boxes(moov.body, moov.end).filter((b) => b.type === 'trak')) {
        const mdia = child(trak, 'mdia'), handler = child(mdia, 'hdlr');
        if (String.fromCharCode(...bytes.subarray(handler.body + 8, handler.body + 12)) !== 'soun') continue;
        const mdhd = child(mdia, 'mdhd'), version = bytes[mdhd.body];
        const timescale = view.getUint32(mdhd.body + (version ? 20 : 12));
        const stbl = child(child(mdia, 'minf'), 'stbl'), stsz = child(stbl, 'stsz'), stts = child(stbl, 'stts');
        const fixed = view.getUint32(stsz.body + 4), samples = view.getUint32(stsz.body + 8);
        let size = fixed * samples, duration = 0;
        if (!fixed) for (let i = 0; i < samples; i++) size += view.getUint32(stsz.body + 12 + i * 4);
        for (let i = 0; i < view.getUint32(stts.body + 4); i++) duration +=
          view.getUint32(stts.body + 8 + i * 8) * view.getUint32(stts.body + 12 + i * 8);
        audio = { samples, bytes: size, seconds: duration / timescale, average: size * 8 / (duration / timescale) };
      }
      return { probe, preferred, codec: r.audioCodec, target: r.audioBitrate, mode: r.audioBitrateMode, audio, frames: r.frames };
    }""")
    f.check(result['frames'] == 60, 'real lowest-quality two-second audio export has 60 video frames')
    f.check(result['target'] == result['probe']['audioBitrate'] and result['target'] in (320000, 192000, 160000),
            'native MP4 audio uses the declared supported target')
    if result['preferred']:
        f.check(result['target'] == 320000, 'native encoder supports preferred 320 kbps and uses it')
    f.check(result['codec'] == result['probe']['audioCodec'], 'audio codec matches the reported preflight codec')
    audio = result['audio']
    f.check(audio is not None and abs(audio['seconds'] - 2) < 0.06, 'actual MP4 audio duration matches its video')
    if audio and result['mode'] == 'constant':
        f.check(abs(audio['average'] - result['target']) / result['target'] < 0.06,
                'actual constant-rate MP4 audio is near the declared bitrate: %r' % audio)
    print('info  %s native audio: %s, %s, target %s bps, measured %s bps' %
          (lang, result['codec'], result['mode'], result['target'], audio and round(audio['average'])))
    f.check(await page.evaluate(DOC) == doc0 and await page.evaluate(DONE) == done0, 'audio validation does not edit document or undo history')
    f.check(await page.evaluate('() => window.__mv.exportState().phase === "idle" && window.__qualityDownloads.length === 0'),
            'in-memory audio validation does not download or enter full-export UI')


async def flow_webm(f, lang):
    page = f.page
    await setup(f)
    await page.evaluate("""() => {
      const a = window.__mv, fallback = (kind) => a.reg.fallback(kind);
      const values = { 'ornament.count': 0, 'filter.count': 0, atmos: 'none', texture: 'none',
        arrange: fallback('arrange'), arrive: fallback('arrive'), depart: fallback('depart'),
        dwell: 'slowDrift', lens: fallback('lens'), seam: fallback('seam'),
        'text.style': 'plain', 'text.scale': 0.8, 'el.text.fill': '#F2C230',
        'amount.flash': 0, 'amount.shake': 0, shot: 'none', rig: 'none' };
      const commands = Object.entries(values).map(([key, v]) => ({ t: 'pin.set', path: 'work:' + key, v, by: 'user' }));
      commands.push({ t: 'output.set', key: 'fps', v: 24 }, ...MV.use('ui/output').formatCmds(a.doc, 'webmAlpha'));
      a.batch({ label: ['undo.output', {}] }, commands); a.store.seal(); a.seek(3);
    }""")
    await f.until('() => !!window.__mv.exportProbe()', 'transparent video codec probed', timeout=15000)
    f.check(await page.evaluate('() => !!window.__mv.exportProbe().vp9Codec'), 'native VP9 or VP8 encoder available')
    await page.evaluate(OBSERVE)
    doc0, done0 = await page.evaluate(DOC), await page.evaluate(DONE)
    await page.locator(START).click()
    await f.until("() => document.querySelector('.export-quality-preview').dataset.previewPhase === 'done'", 'four transparent comparison clips complete', timeout=120000)
    await f.until("() => [...document.querySelectorAll('[data-preview-quality] video')].length === 4 && [...document.querySelectorAll('[data-preview-quality] video')].every((v) => v.readyState >= 2)",
                  'all native transparent clips decode', timeout=20000)
    clips = await page.evaluate(CLIPS)
    f.check([c['quality'] for c in clips] == list(QUALITIES) and
            all((c['w'], c['h']) == (1280, 720) and abs(c['duration'] - 3) < 0.05 for c in clips),
            'transparent comparison uses four qualities at chosen size and three-second range')
    calls = await page.evaluate("() => window.__qualityCalls.map(({ blob, ...rest }) => rest)")
    f.check(len(calls) == 4 and all(c['type'] == 'webm' and c['done'] and c['frames'] == 72 and c['fps'] == 24
                                  and c['format'] == 'webmAlpha' and not c['sound'] and not c['audio'] for c in calls),
            'transparent preview encodes the actual WebM path, without sound')
    tables = await page.evaluate(WEBM_TABLES)
    f.check(len(tables) == 4 and all(t['type'] == 'video/webm' and t['frames'] == 72 and t['alphaFrames'] == 72
                                   and t['alpha'] and not t['audio'] and abs(t['duration'] - 3) < 1e-6 for t in tables),
            'actual WebM tables contain 72 colour and alpha samples, no audio: %r' % tables)
    first = await page.evaluate(PIXELS, {'relative': 0.75, 'source': 3.75, 'alpha': True})
    later = await page.evaluate(PIXELS, {'relative': 1.75, 'source': 4.75, 'alpha': True})
    f.check(all(max(x['corners']) <= 4 and x['clear'] > 160 * 90 * 0.6 and x['opaque'] > 30 and x['partial'] > 5 for x in first + later),
            'native decoded videos preserve clear corners and opaque/antialiased glyphs: %r' % (first + later))
    f.check(all(x['opaqueError'] is not None and x['opaqueError'] < 20 and x['alphaError'] < 8 for x in first + later),
            'transparent encoded colour and alpha agree with the committed scene')
    f.check(all(a['hash'] != b['hash'] for a, b in zip(first, later)), 'transparent text visibly moves in every quality')
    f.check(await page.evaluate(DOC) == doc0 and await page.evaluate(DONE) == done0 and
            await page.evaluate('() => window.__mv.exportState().phase === "idle" && window.__qualityDownloads.length === 0'),
            'transparent comparison preserves document/history and does not download or start full export')
    await f.shot('transparent_comparison')


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', help='tree to serve')
    ap.add_argument('--shots', help='write screenshots here')
    ap.add_argument('--flow', choices=('settings', 'comparison', 'webm', 'audio'))
    ap.add_argument('--no-build', action='store_true', help='serve pages already built by the integration task')
    args = ap.parse_args()
    root = Path(args.root).resolve() if args.root else ROOT
    if not args.no_build:
        ensure_built(root)
    if args.shots:
        Path(args.shots).mkdir(parents=True, exist_ok=True)
    server = serve(root)
    base = 'http://127.0.0.1:%d/' % server.server_address[1]
    failures, count = [], 0
    try:
        async with async_playwright() as p:
            browser = await launch(p)
            try:
                for rel, lang in (('index.html', 'ja'), ('en/index.html', 'en')):
                    for name, run in (('settings', flow_settings), ('comparison', flow_comparison), ('audio', flow_audio), ('webm', flow_webm)):
                        if args.flow and args.flow != name:
                            continue
                        page = await open_page(browser, base, rel)
                        f = Flow(lang + '_' + name, page, args.shots)
                        try:
                            await run(f, lang)
                        except Exception as err:
                            f.problems.append(str(err))
                        f.problems += ['page error: ' + e for e in f.errors]
                        csp = await page.evaluate('() => window.__csp')
                        if csp:
                            f.problems.append('CSP violations: ' + repr(csp))
                        count += 1
                        print('%s %s' % ('FAIL ' if f.problems else 'ok   ', f.name), flush=True)
                        failures += [f.name + ': ' + msg for msg in f.problems]
                        await page.close()
            finally:
                await browser.close()
    finally:
        server.shutdown()
    for msg in failures:
        print('  ' + msg)
    print('export_quality.py: %s (%d JA/EN cases)' % ('FAILED' if failures else 'OK', count))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
