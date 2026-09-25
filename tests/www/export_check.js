/* 文字PVメーカー v2 — original work. Browser harness for tests/browser/export_check.py (not shipped): WP6 media in a real page. */
// Loaded after the app modules (concatenated like build.py) and tests/helpers/fake_engine.js. Exposes window.__exportCheck.
(function () {
  'use strict';
  const S = MV.use('export/schedule');
  const MP4 = MV.use('export/host/mp4');
  const PNG = MV.use('export/host/png');
  const SINK = MV.use('export/host/sink');
  const DEC = MV.use('audio/host/decode');
  const PLAYER = MV.use('audio/host/player');
  const WAV = MV.use('audio/wav');
  const DIGEST = MV.use('audio/digest');
  const docs = MV.use('core/doc');

  // Only when this browser cannot encode H.264. The audio takes the default order (AAC, else Opus: DESIGN_2_1 §13.4).
  const FALLBACK = { video: 'vp09.00.10.08' };
  const NO_AAC = ['bogus.aac', 'opus'];     // codecs.audioList that forces the Opus fallback where AAC would encode
  const CLIP = 'a3f9c2d17b0e4a5c6d7e8f901';
  const MP4_SECONDS = 2.5;   // 75 frames at 30 fps: longer than one 2·fps key-frame interval, so frame 60 must be a key

  function testDoc({ seconds = 2, fps = 30, short = 720, format = 'mp4', backdrop = 'scene', t0 = 0, title = '書き出しテスト' } = {}) {
    const doc = docs.defaultDoc();
    doc.sheet = { next: 4, rows: [
      { id: 'r1', src: '[ti:' + title + ']' }, { id: 'r2', src: '[00:00.20]夜明けの街' }, { id: 'r3', src: '[00:01.10]hello world' },
    ] };
    doc.look.backdrop = backdrop;
    Object.assign(doc.output, { format, fps, short, quality: 'standard', range: { t0, t1: t0 + seconds } });
    return doc;
  }

  function engineFor(doc) {
    const engine = MVFake.createEngine({});
    engine.setDoc(doc);
    return engine;
  }

  function toneBuffer(seconds, rate) {
    const b = new AudioBuffer({ length: Math.round(seconds * rate), numberOfChannels: 2, sampleRate: rate });
    const l = b.getChannelData(0), r = b.getChannelData(1);
    for (let i = 0; i < b.length; i++) { l[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / rate); r[i] = 0.3 * Math.sin((2 * Math.PI * 660 * i) / rate); }
    return b;
  }

  function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // --- a small MP4 reader: tracks, sample tables, decoder config --------------------------------------------------

  function* boxes(v, start, end) {
    for (let p = start; p + 8 <= end;) {
      let size = v.getUint32(p);
      const type = String.fromCharCode(v.getUint8(p + 4), v.getUint8(p + 5), v.getUint8(p + 6), v.getUint8(p + 7));
      let head = 8;
      if (size === 1) { size = v.getUint32(p + 8) * 0x100000000 + v.getUint32(p + 12); head = 16; }
      else if (size === 0) size = end - p;
      yield { type, start: p, body: p + head, end: p + size };
      p += size;
    }
  }

  function child(v, box, type) {
    for (const b of boxes(v, box.body, box.end)) if (b.type === type) return b;
    return null;
  }

  function path(v, box, types) {
    let cur = box;
    for (const t of types) { cur = cur && child(v, cur, t); }
    return cur;
  }

  function readTrack(v, bytes, trak) {
    const mdia = child(v, trak, 'mdia');
    const mdhd = child(v, mdia, 'mdhd');
    const version = v.getUint8(mdhd.body);
    const timescale = version === 1 ? v.getUint32(mdhd.body + 20) : v.getUint32(mdhd.body + 12);
    const duration = version === 1 ? v.getUint32(mdhd.body + 24) * 0x100000000 + v.getUint32(mdhd.body + 28) : v.getUint32(mdhd.body + 16);
    const hdlr = child(v, mdia, 'hdlr');
    const kind = String.fromCharCode(...bytes.subarray(hdlr.body + 8, hdlr.body + 12));
    const stbl = path(v, mdia, ['minf', 'stbl']);
    const stsd = child(v, stbl, 'stsd');
    const entry = boxes(v, stsd.body + 8, stsd.end).next().value;
    const track = { kind, timescale, duration, format: entry.type, samples: [] };
    if (kind === 'soun') {
      // AudioSampleEntry: 28 bytes of fields after the box header, then its boxes (esds for AAC, dOps for Opus)
      track.channels = v.getUint16(entry.start + 24);
      track.rate = v.getUint32(entry.start + 32) / 65536;
      track.boxes = [];
      for (const b of boxes(v, entry.start + 36, entry.end)) {
        track.boxes.push(b.type);
        if (b.type === 'dOps') {
          track.dOps = { version: v.getUint8(b.body), channels: v.getUint8(b.body + 1), preSkip: v.getUint16(b.body + 2),
            rate: v.getUint32(b.body + 4) };
        }
      }
    }
    if (kind === 'vide') {
      track.width = v.getUint16(entry.start + 32);
      track.height = v.getUint16(entry.start + 34);
      for (const b of boxes(v, entry.start + 86, entry.end)) {
        if (b.type === 'avcC' || b.type === 'vpcC' || b.type === 'av1C') track.config = bytes.slice(b.body, b.end);
      }
    }
    const sizes = [];
    const stsz = child(v, stbl, 'stsz');
    const fixed = v.getUint32(stsz.body + 4), count = v.getUint32(stsz.body + 8);
    for (let i = 0; i < count; i++) sizes.push(fixed || v.getUint32(stsz.body + 12 + 4 * i));
    const deltas = [];
    const stts = child(v, stbl, 'stts');
    for (let e = 0, n = v.getUint32(stts.body + 4); e < n; e++) {
      const c = v.getUint32(stts.body + 8 + 8 * e), d = v.getUint32(stts.body + 12 + 8 * e);
      for (let k = 0; k < c; k++) deltas.push(d);
    }
    const stco = child(v, stbl, 'stco'), co64 = child(v, stbl, 'co64');
    const chunks = [];
    if (stco) for (let i = 0, n = v.getUint32(stco.body + 4); i < n; i++) chunks.push(v.getUint32(stco.body + 8 + 4 * i));
    if (co64) for (let i = 0, n = v.getUint32(co64.body + 4); i < n; i++) chunks.push(v.getUint32(co64.body + 8 + 8 * i) * 0x100000000 + v.getUint32(co64.body + 12 + 8 * i));
    const stsc = child(v, stbl, 'stsc');
    const runs = [];
    for (let e = 0, n = v.getUint32(stsc.body + 4); e < n; e++) runs.push([v.getUint32(stsc.body + 8 + 12 * e), v.getUint32(stsc.body + 12 + 12 * e)]);
    const stss = child(v, stbl, 'stss');
    const keys = new Set();
    if (stss) for (let i = 0, n = v.getUint32(stss.body + 4); i < n; i++) keys.add(v.getUint32(stss.body + 8 + 4 * i));
    let s = 0, dts = 0;
    for (let c = 0; c < chunks.length; c++) {
      let per = 0;
      for (const [first, n] of runs) if (c + 1 >= first) per = n;
      let offset = chunks[c];
      for (let k = 0; k < per && s < sizes.length; k++, s++) {
        track.samples.push({ offset, size: sizes[s], dts, dur: deltas[s], key: stss ? keys.has(s + 1) : true });
        offset += sizes[s];
        dts += deltas[s];
      }
    }
    track.keyCount = track.samples.filter((x) => x.key).length;
    track.sampleSum = dts;
    return track;
  }

  function parseMp4(bytes) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const top = Array.from(boxes(v, 0, bytes.length));
    const moov = top.find((b) => b.type === 'moov');
    const tracks = [];
    for (const b of boxes(v, moov.body, moov.end)) if (b.type === 'trak') tracks.push(readTrack(v, bytes, b));
    return { order: top.map((b) => b.type), tracks };
  }

  async function decodeVideo(track, bytes, codec) {
    let count = 0, error = null;
    const decoder = new VideoDecoder({ output: (f) => { count++; f.close(); }, error: (e) => { error = e; } });
    const config = { codec, codedWidth: track.width, codedHeight: track.height };
    if (track.format === 'avc1') {
      const c = track.config;
      config.codec = 'avc1.' + [c[1], c[2], c[3]].map((x) => x.toString(16).padStart(2, '0')).join('');
      config.description = c;
    }
    decoder.configure(config);
    for (const s of track.samples) {
      decoder.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: Math.round((s.dts * 1e6) / track.timescale),
        duration: Math.round((s.dur * 1e6) / track.timescale), data: bytes.subarray(s.offset, s.offset + s.size) }));
    }
    await decoder.flush();
    decoder.close();
    return { count, error: error && String(error), codec: config.codec };
  }

  async function summarize(bytes, codecs) {
    const mp4 = parseMp4(bytes);
    const video = mp4.tracks.find((t) => t.kind === 'vide');
    const audio = mp4.tracks.find((t) => t.kind === 'soun');
    const decoded = await decodeVideo(video, bytes, (codecs && codecs.video) || '');
    return {
      order: mp4.order, bytes: bytes.length,
      video: { format: video.format, width: video.width, height: video.height, samples: video.samples.length, keys: video.keyCount,
        keyIndices: video.samples.map((x, i) => (x.key ? i : -1)).filter((i) => i >= 0),
        seconds: video.duration / video.timescale, sampleSeconds: video.sampleSum / video.timescale, firstDts: video.samples[0].dts,
        decoded: decoded.count, decodeError: decoded.error, codec: decoded.codec },
      audio: audio ? { format: audio.format, seconds: audio.duration / audio.timescale, rate: audio.timescale, channels: audio.channels,
        boxes: audio.boxes, dOps: audio.dOps || null, samples: audio.samples.length } : null,
    };
  }

  function rmsOf(buffers) {
    let sum = 0, n = 0;
    for (const x of buffers) for (let i = 0; i < x.length; i++) { sum += x[i] * x[i]; n++; }
    return n ? Math.sqrt(sum / n) : 0;
  }

  // The sound of an MP4: decodeAudioData of the whole file; where this browser's media stack cannot open the MP4
  // container (a Chromium build without proprietary codecs), an AudioDecoder over the file's own sample table.
  async function decodeSound(bytes) {
    try {
      const ctx = new OfflineAudioContext(2, 48000, 48000);
      const buffer = await ctx.decodeAudioData(bytes.slice().buffer);
      const planes = [];
      for (let c = 0; c < buffer.numberOfChannels; c++) planes.push(buffer.getChannelData(c));
      return { via: 'decodeAudioData', seconds: buffer.duration, rms: rmsOf(planes), channels: buffer.numberOfChannels };
    } catch (err) {
      const reason = String(err && err.message);
      const mp4 = parseMp4(bytes);
      const track = mp4.tracks.find((t) => t.kind === 'soun');
      if (!track) return { via: 'none', seconds: 0, rms: 0, channels: 0, reason };
      const planes = [];
      let frames = 0, error = null;
      const decoder = new AudioDecoder({
        output: (d) => {
          const plane = new Float32Array(d.numberOfFrames);
          d.copyTo(plane, { planeIndex: 0, format: 'f32-planar' });
          planes.push(plane);
          frames += d.numberOfFrames;
          d.close();
        },
        error: (e) => { error = String(e); },
      });
      decoder.configure({ codec: track.format === 'Opus' ? 'opus' : 'mp4a.40.2', sampleRate: track.rate, numberOfChannels: track.channels });
      for (const s of track.samples) {
        decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round((s.dts * 1e6) / track.timescale),
          data: bytes.subarray(s.offset, s.offset + s.size) }));
      }
      await decoder.flush();
      decoder.close();
      return { via: 'AudioDecoder (' + reason + ')', seconds: frames / track.rate, rms: rmsOf(planes), channels: track.channels, error };
    }
  }

  // Opus in MP4 (DESIGN_2_1 §13.4): AAC forced unavailable with codecs.audioList, a 2.5 s export with a tone.
  async function opusCheck(fallback) {
    const codecs = Object.assign(fallback ? { video: FALLBACK.video } : {}, { audioList: NO_AAC });
    const size = S.outputSize('16:9', 720);
    const probe = await MP4.probe({ w: size.w, h: size.h, fps: 30, codecs });
    if (probe.audioCodec !== 'opus') return { probeAudio: probe.audioCodec };
    const doc = testDoc({ seconds: MP4_SECONDS });
    doc.song = { name: 'tone.wav', sha1: '0'.repeat(40), seconds: 3, bpm: null, offset: 0, meter: 4, bpmConfidence: null, digest: null, info: null };
    const engine = engineFor(doc);
    const result = await MP4.exportVideo({ engine, doc, audio: toneBuffer(3, 48000), sink: SINK.createMemorySink({ type: 'video/mp4' }), codecs });
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const pre = S.preflight(doc, engine.plan, { webcodecs: true, codec: probe.codec, anyCodec: probe.anyCodec, audioCodec: probe.audioCodec,
      fontsReady: true, fsAccess: true, warnings: [] });
    return { probeAudio: probe.audioCodec, result: { frames: result.frames, audio: result.audio, audioCodec: result.audioCodec },
      file: await summarize(bytes, codecs), sound: await decodeSound(bytes), preflight: pre.map((x) => x.code) };
  }

  // An engine whose forks have a mediaReady that records the times it is asked for (and fails on the 5th when `fail`).
  function readyEngine(doc, fail) {
    const engine = engineFor(doc);
    const calls = [];
    const fork = engine.fork;
    engine.fork = () => {
      const e = fork.call(engine);
      e.mediaReady = (t, o) => {
        calls.push({ t, fps: o && o.fps, signal: !!(o && 'signal' in o) });
        if (fail && calls.length === 5) {
          return Promise.reject(Object.assign(new Error('media not on this device: ' + CLIP), { code: 'media-missing', id: CLIP }));
        }
        return Promise.resolve();
      };
      return e;
    };
    return { engine, calls };
  }

  // The export loops await engine.mediaReady(t0 + i / fps) before every frame (DESIGN_2_1 §11.4.5); a store failure
  // stops the export with ExportError('media') naming the asset, and nothing is kept.
  async function mediaWaitChecks(codecs) {
    const out = {};
    const doc = testDoc({ seconds: 0.5, t0: 0.4 });
    doc.media = { list: [{ id: CLIP, name: '海辺.mp4' }] };
    const m = readyEngine(doc, false);
    await MP4.exportVideo({ engine: m.engine, doc, audio: null, sink: SINK.createMemorySink(), codecs });
    out.mp4 = m.calls;
    const pngDoc = testDoc({ format: 'png', seconds: 0.5, t0: 0.4 });
    const p = readyEngine(pngDoc, false);
    await PNG.exportPngs({ engine: p.engine, doc: pngDoc, alpha: false, sink: SINK.createMemorySink() });
    out.png = p.calls;
    const bad = readyEngine(doc, true);
    const sink = SINK.createMemorySink();
    const failed = await captureDetail(MP4.exportVideo({ engine: bad.engine, doc, audio: null, sink, codecs }));
    out.fail = Object.assign(failed, { bytesLeft: sink.bytes, asked: bad.calls.length });
    const badPng = readyEngine(pngDoc, true);
    pngDoc.media = doc.media;
    const pngSink = SINK.createMemorySink();
    const failedPng = await captureDetail(PNG.exportPngs({ engine: badPng.engine, doc: pngDoc, alpha: false, sink: pngSink }));
    out.failPng = Object.assign(failedPng, { bytesLeft: pngSink.bytes });
    return out;
  }

  // --- OPFS file handles (a real File System Access sink without a dialog) ----------------------------------------

  async function opfsHandle(name) {
    const dir = await navigator.storage.getDirectory();
    return { dir, handle: await dir.getFileHandle(name, { create: true }) };
  }

  async function opfsHas(dir, name) {
    for await (const key of dir.keys()) if (key === name) return true;
    return false;
  }

  async function captureDetail(promise) {
    try { await promise; return { ok: true }; } catch (e) {
      return { ok: false, code: e && e.code, message: String(e && e.message), detail: (e && e.detail) || null };
    }
  }

  async function capture(promise) {
    try { return { ok: true, value: await promise }; } catch (e) { return { ok: false, code: e && e.code, message: String(e && e.message) }; }
  }

  // --- checks -----------------------------------------------------------------------------------------------------

  // A 16-bit WAVE_FORMAT_EXTENSIBLE 5.1 file (L R C LFE SL SR) with a 0.3 tone on the centre channel only.
  function centreOnlyWav(seconds, rate) {
    const n = Math.round(seconds * rate), ch = 6, data = n * ch * 2;
    const bytes = new Uint8Array(68 + data);
    const v = new DataView(bytes.buffer);
    const ascii = (at, text) => { for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i); };
    ascii(0, 'RIFF'); v.setUint32(4, 60 + data, true); ascii(8, 'WAVE');
    ascii(12, 'fmt '); v.setUint32(16, 40, true);
    v.setUint16(20, 0xfffe, true); v.setUint16(22, ch, true); v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true);
    v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); v.setUint16(36, 22, true); v.setUint16(38, 16, true);
    v.setUint32(40, 0x3f, true);
    bytes.set([1, 0, 0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71], 44);   // PCM sub-format GUID
    ascii(60, 'data'); v.setUint32(64, data, true);
    for (let i = 0; i < n; i++) v.setInt16(68 + (i * ch + 2) * 2, Math.round(0.3 * 32767 * Math.sin((2 * Math.PI * 330 * i) / rate)), true);
    return bytes;
  }

  function peakOf(samples) {
    let m = 0;
    for (let i = 0; i < samples.length; i++) m = Math.max(m, Math.abs(samples[i]));
    return m;
  }

  // Swaps the global AudioEncoder for a subclass that records the per-channel peak of every AudioData it is given.
  function recordAudioEncoder() {
    const Real = window.AudioEncoder;
    const peaks = [];
    window.AudioEncoder = class extends Real {
      encode(data) {
        const plane = new Float32Array(data.numberOfFrames);
        for (let c = 0; c < data.numberOfChannels; c++) {
          data.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
          peaks[c] = Math.max(peaks[c] || 0, peakOf(plane));
        }
        return super.encode(data);
      }
    };
    return { peaks, restore() { window.AudioEncoder = Real; } };
  }

  // A 5.1 song through decodeFile and exportVideo: what reaches the AudioEncoder must hold the centre channel.
  async function surroundCheck(codecs) {
    const decoded = await DEC.decodeFile(new File([centreOnlyWav(1.5, 48000)], 'surround.wav', { type: 'audio/wav' }));
    const buffer = decoded.buffer;
    const sourcePeaks = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) sourcePeaks.push(peakOf(buffer.getChannelData(c)));
    const doc = testDoc({ seconds: 1 });
    const recorder = recordAudioEncoder();
    try {
      const result = await MP4.exportVideo({ engine: engineFor(doc), doc, audio: buffer, sink: SINK.createMemorySink(), codecs });
      return { channels: buffer.numberOfChannels, sourcePeaks, sentPeaks: recorder.peaks.slice(), audio: result.audio };
    } finally {
      recorder.restore();
    }
  }

  async function mp4Checks(fallback) {
    const codecs = fallback ? FALLBACK : null;
    const out = {};
    const doc = testDoc({ seconds: MP4_SECONDS });
    const audio = toneBuffer(3, 48000);
    const progress = [];

    const file = await opfsHandle('export_check.mp4');
    const streamed = await MP4.exportVideo({ engine: engineFor(doc), doc, audio, sink: SINK.createFileSink(file.handle), codecs,
      onProgress: (p) => progress.push(p) });
    const fileBytes = new Uint8Array(await (await file.handle.getFile()).arrayBuffer());
    out.stream = Object.assign({ result: { frames: streamed.frames, bytes: streamed.bytes, codec: streamed.codec, audio: streamed.audio,
      audioCodec: streamed.audioCodec, name: streamed.name } }, await summarize(fileBytes, codecs));
    out.progress = { calls: progress.length, last: progress[progress.length - 1], etaNumbers: progress.slice(1).every((p) => typeof p.eta === 'number') };
    await file.dir.removeEntry('export_check.mp4');

    const memDoc = testDoc({ seconds: MP4_SECONDS, backdrop: 'clear' });
    const memory = await MP4.exportVideo({ engine: engineFor(memDoc), doc: memDoc, audio: null, sink: SINK.createMemorySink({ type: 'video/mp4' }), codecs });
    out.memory = Object.assign({ result: { frames: memory.frames, bytes: memory.bytes, audio: memory.audio, name: memory.name } },
      await summarize(new Uint8Array(await memory.blob.arrayBuffer()), codecs));

    const gone = await opfsHandle('export_cancel.mp4');
    const controller = new AbortController();
    const cancel = await capture(MP4.exportVideo({ engine: engineFor(doc), doc, audio, sink: SINK.createFileSink(gone.handle), codecs,
      signal: controller.signal, onProgress: (p) => { if (p.i === 5) controller.abort(); } }));
    out.cancel = { ok: cancel.ok, code: cancel.code, fileLeft: await opfsHas(gone.dir, 'export_cancel.mp4') };
    out.surround = await surroundCheck(codecs);
    out.opus = await opusCheck(fallback);
    out.wait = await mediaWaitChecks(codecs);
    return out;
  }

  async function firstPixelAlpha(zipBlob) {
    const head = new DataView(await zipBlob.slice(0, 30).arrayBuffer());
    const start = 30 + head.getUint16(26, true) + head.getUint16(28, true);
    const png = zipBlob.slice(start, start + head.getUint32(18, true), 'image/png');
    const bitmap = await createImageBitmap(png);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = canvas.getContext('2d');
    g.drawImage(bitmap, 0, 0);
    return { corner: g.getImageData(0, 0, 1, 1).data[3], width: bitmap.width, height: bitmap.height };
  }

  async function pngChecks() {
    const out = {};
    const doc = testDoc({ format: 'png' });
    const plain = await PNG.exportPngs({ engine: engineFor(doc), doc, alpha: false, sink: SINK.createMemorySink({ type: 'application/zip' }) });
    out.plain = { frames: plain.frames, name: plain.name, pixel: await firstPixelAlpha(plain.blob),
      zip: toBase64(new Uint8Array(await plain.blob.arrayBuffer())) };
    // The first cut fades in here. The title puts an emoji across the 80-unit name limit: the ZIP names stay valid UTF-8.
    const alphaDoc = testDoc({ format: 'pngAlpha', seconds: 0.5, fps: 24, t0: 0.8, title: 'a'.repeat(79) + '🎵 live' });
    const alpha = await PNG.exportPngs({ engine: engineFor(alphaDoc), doc: alphaDoc, alpha: true, sink: SINK.createMemorySink() });
    out.alpha = { frames: alpha.frames, name: alpha.name, pixel: await firstPixelAlpha(alpha.blob),
      zip: toBase64(new Uint8Array(await alpha.blob.arrayBuffer())) };
    const sink = SINK.createMemorySink();
    const controller = new AbortController();
    const cancel = await capture(PNG.exportPngs({ engine: engineFor(doc), doc, alpha: false, sink, signal: controller.signal,
      onProgress: (p) => { if (p.i === 3) controller.abort(); } }));
    out.cancel = { ok: cancel.ok, code: cancel.code, bytesLeft: sink.bytes };
    return out;
  }

  function clickTrack(bpm, offset, seconds, rate) {
    const n = Math.round(seconds * rate);
    const x = new Float32Array(n);
    let seed = 12345;
    const noise = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296 - 0.5; };
    for (let k = 0; offset + (k * 60) / bpm < seconds; k++) {
      const a = Math.round((offset + (k * 60) / bpm) * rate);
      for (let i = 0; i < 0.03 * rate && a + i < n; i++) x[a + i] = 1.6 * noise() * Math.exp(-i / (0.004 * rate));
    }
    return x;
  }

  async function audioChecks() {
    const wav = WAV.encodeWav([clickTrack(128, 0.3, 8, 48000)], 48000, 16000);
    const loaded = await DEC.loadSong(new File([wav], 'clicks.wav', { type: 'audio/wav' }));
    const doc = docs.defaultDoc();
    doc.song = loaded.song;
    const empty = await capture(DEC.decodeFile(new Blob([])));
    const junk = await capture(DEC.decodeFile(new Blob([new Uint8Array(1000).fill(7)])));
    return {
      wav: toBase64(wav), sha1: loaded.song.sha1, name: loaded.song.name, rate: loaded.buffer.sampleRate, length: loaded.buffer.length,
      seconds: loaded.song.seconds, bpm: loaded.song.bpm, offset: loaded.song.offset, confidence: loaded.song.bpmConfidence,
      digestFrames: DIGEST.envFromDigest(loaded.song.digest).loud.length, problems: docs.validate(doc),
      peakLevels: loaded.peaks.levels.length, emptyCode: empty.code, junkCode: junk.code,
    };
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function playerChecks() {
    const out = {};
    const p = PLAYER.createPlayer({ buffer: null, duration: 1 });
    const events = [];
    p.on('ended', () => events.push('ended'));
    p.play();
    await sleep(300);
    out.running = p.now();
    out.eventTime = p.outputTimeOf(performance.now());
    p.pause();
    const paused = p.now();
    await sleep(100);
    out.pausedStable = p.now() === paused;
    p.seek(0.9);
    out.seeked = p.now();
    p.play();
    await sleep(400);
    out.ended = events.slice();
    out.atEnd = p.now();
    out.playing = p.playing;
    p.dispose();
    const song = PLAYER.createPlayer({ buffer: toneBuffer(2, 48000), duration: 2 });
    song.setMuted(true);
    song.play(0.5);
    await sleep(600);
    out.song = { now: song.now(), playing: song.playing, muted: song.muted };
    song.dispose();
    return out;
  }

  // The WP6 acceptance run (export_check.py --long): a fixture project at its own settings (1080p30), `seconds` long.
  window.__exportLong = async function (doc, seconds, fallback) {
    const codecs = fallback ? FALLBACK : null;
    doc.song.seconds = seconds;
    const file = await opfsHandle('export_long.mp4');
    const started = performance.now();
    const result = await MP4.exportVideo({ engine: engineFor(doc), doc, audio: toneBuffer(seconds, 48000),
      sink: SINK.createFileSink(file.handle), codecs });
    const ms = performance.now() - started;
    const bytes = new Uint8Array(await (await file.handle.getFile()).arrayBuffer());
    const summary = await summarize(bytes, codecs);
    await file.dir.removeEntry('export_long.mp4');
    return Object.assign({ result: { frames: result.frames, bytes: result.bytes, audio: result.audio, codec: result.codec }, ms }, summary);
  };

  window.__exportCheck = async function () {
    const size = S.outputSize('16:9', 720);
    const probe = await MP4.probe({ w: size.w, h: size.h, fps: 30 });
    let fallback = false;
    if (!probe.codec) {
      const vp9 = typeof VideoEncoder === 'function' &&
        (await VideoEncoder.isConfigSupported({ codec: FALLBACK.video, width: size.w, height: size.h, bitrate: 2e6, framerate: 30 })).supported;
      fallback = vp9 ? 'vp9' : 'none';
    }
    const result = { probe, fallback };
    result.mp4 = fallback === 'none' ? null : await mp4Checks(!!fallback);
    result.png = await pngChecks();
    result.audio = await audioChecks();
    result.player = await playerChecks();
    return result;
  };
})();
