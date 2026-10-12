/* 文字PVメーカー v2 — original work. External AAC: frozen silent MP4 + exact original PCM range → configured HTTPS service → original video with AAC 320 kbps. */
MV.def('export/host/audio_server', ['export/schedule', 'export/host/mp4', 'export/host/sink', 'export/host/audio_source', 'media/isobmff'], (S, J, SINK, SOURCE, ISO) => {
  'use strict';

  const SERVICE = 'moji-pv-audio';
  const VERSION = 1;
  const TARGET = SOURCE.TARGET;
  const MULTIPART_MARGIN = 64 * 1024;
  const PREFIX_LIMIT = ISO.MAX_MOOV + 8192;

  function error(code, detail) { return new S.ExportError('audio-server-' + code, 'external audio conversion ' + code, detail); }

  // HTTPS only. No credentials, query or fragment can silently send a secret to a different place. A path prefix is
  // allowed for services behind a reverse proxy. Tokens stay in request headers and never enter export metadata.
  function validateConfig(input) {
    const raw = input || {};
    if (typeof raw.url !== 'string' || !raw.url.trim()) throw error('config');
    let url;
    try { url = new URL(raw.url.trim()); } catch (err) { throw error('config'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.href.includes('?') || url.href.includes('#')) throw error('config');
    const token = raw.token === undefined ? '' : raw.token;
    if (typeof token !== 'string' || (token && !/^[\x21-\x7e]{1,4096}$/.test(token))) throw error('config');
    return { url: url.href.replace(/\/+$/, ''), token };
  }

  function httpError(status) {
    const kind = status === 401 || status === 403 ? 'auth' : status === 413 ? 'too-large' : status === 422 ? 'media'
      : status === 429 ? 'busy' : status === 504 ? 'timeout' : 'convert';
    return error(kind, { status });
  }

  async function cancelBody(response) {
    try { if (response && response.body) await response.body.cancel(); } catch (err) { /* already read or closed */ }
  }

  async function request(config, path, init, fetchImpl) {
    const opts = Object.assign({ credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store' }, init);
    J.checkAbort(opts.signal);
    let response;
    try { response = await (fetchImpl || globalThis.fetch)(config.url + path, opts); }
    catch (err) {
      J.checkAbort(opts.signal);
      if (err && err.name === 'AbortError') throw new S.ExportError('cancelled', 'export cancelled');
      // A fetch exception or server error may contain an endpoint, token or an internal path. Do not echo it.
      throw error('network');
    }
    if ((opts.signal && opts.signal.aborted) || !response || !response.ok) {
      await cancelBody(response);
      J.checkAbort(opts.signal);
      throw httpError(response ? response.status : 0);
    }
    return response;
  }

  // Health confirms reachability/protocol/limits; authentication is checked only when converting. No song or token is
  // sent by this check, so opening settings does not disclose media to a configured service.
  async function check(input, opts) {
    const config = validateConfig(input), o = opts || {};
    const response = await request(config, '/health', { signal: o.signal, headers: { Accept: 'application/json' } }, o.fetchImpl);
    let value;
    try { value = await response.json(); } catch (err) { J.checkAbort(o.signal); throw error('response'); }
    J.checkAbort(o.signal);
    if (!value || value.service !== SERVICE || value.version !== VERSION || value.targetBitrate !== TARGET
      || !Number.isSafeInteger(value.maxUploadBytes) || value.maxUploadBytes <= MULTIPART_MARGIN) throw error('response');
    return { service: SERVICE, version: VERSION, targetBitrate: TARGET, maxUploadBytes: value.maxUploadBytes, authChecked: false };
  }

  // Same trim, downmix and silence padding as the browser encoder. This is the source PCM, never audio decoded from a
  // 192 kbps intermediate MP4. The range is N/fps (including the final rendered frame), not the unrounded UI duration.
  function audioBlob(song, job, signal) { return SOURCE.audioBlob(song, job, signal, error); }

  function headerNumber(headers, name) {
    const raw = headers && headers.get(name);
    return raw && /^\d+$/.test(raw) ? Number(raw) : null;
  }

  function resultInfo(response, frames) {
    const headers = response.headers;
    const type = headers && headers.get('Content-Type');
    const target = headerNumber(headers, 'X-Audio-Bitrate-Target');
    const count = headerNumber(headers, 'X-Video-Frames');
    if (!type || type.split(';')[0].trim().toLowerCase() !== 'video/mp4' || target !== TARGET || count !== frames
      || headers.get('X-Audio-Codec') !== 'aac') throw error('response');
    const raw = headers.get('X-Audio-Bitrate-Measured');
    const measured = raw ? Number(raw) : null;
    if (raw && (!Number.isFinite(measured) || measured <= 0)) throw error('response');
    return { audio: true, audioCodec: 'mp4a.40.2', audioBitrate: TARGET, audioBitrateMode: null, audioSource: 'server',
      audioMeasuredBitrate: measured };
  }

  function prefixRange(parts, at, length) {
    const out = new Uint8Array(length);
    let from = 0, copied = 0;
    for (const part of parts) {
      const a = Math.max(0, at - from), b = Math.min(part.byteLength, at + length - from);
      if (b > a) { out.set(part.subarray(a, b), copied); copied += b - a; }
      from += part.byteLength;
      if (copied === length) break;
    }
    return out;
  }

  // The service returns faststart MP4. Validate its bounded metadata prefix before committing any payload to a sink:
  // a 200 response with correct headers but HTML, a silent file or missing frames cannot masquerade as AAC320 output.
  // Only the moov/header prefix is copied; the potentially large mdat is streamed without an extra whole-file buffer.
  async function validPrefix(parts, received, total, job) {
    let at = 0, ftyp = false, moov = false;
    while (at + 8 <= received) {
      const head = prefixRange(parts, at, Math.min(16, received - at)), view = new DataView(head.buffer);
      let size = view.getUint32(0), header = 8;
      const type = String.fromCharCode(head[4], head[5], head[6], head[7]);
      if (size === 1) {
        if (head.length < 16) return false;
        size = view.getUint32(8) * 0x100000000 + view.getUint32(12); header = 16;
      } else if (size === 0) size = total - at;
      if (!Number.isSafeInteger(size) || size < header || at + size > total) throw error('response');
      if (at === 0 && type !== 'ftyp') throw error('response');
      if (type === 'mdat') {
        if (!ftyp || !moov || at + size !== total) throw error('response');
        const prefix = prefixRange(parts, 0, at + header);
        let movie;
        try {
          movie = await ISO.parse(async (offset, length) => prefix.subarray(offset, offset + length), total);
        } catch (err) { throw error('response'); }
        SOURCE.validateMovie(movie, job, error);
        return true;
      }
      if (at + size > PREFIX_LIMIT || (type === 'ftyp' && size > 4096)) throw error('response');
      if (at + size > received) return false;
      if (type === 'ftyp') ftyp = true;
      else if (type === 'moov') { if (moov) throw error('response'); moov = true; }
      else if (type !== 'free' && type !== 'wide') throw error('response');
      at += size;
    }
    return false;
  }

  async function intoSink(response, sink, signal, job) {
    const expected = headerNumber(response.headers, 'Content-Length');
    let bytes = 0, reader = null, validated = false;
    let prefix = [];
    try {
      if (response.body && typeof response.body.getReader === 'function') {
        reader = response.body.getReader();
        while (true) {
          J.checkAbort(signal);
          const item = await reader.read();
          J.checkAbort(signal);
          if (item.done) break;
          if (item.value && item.value.byteLength) {
            bytes += item.value.byteLength;
            if (!expected || bytes > expected) throw error('response');
            if (!validated) {
              prefix.push(item.value);
              validated = await validPrefix(prefix, bytes, expected, job);
              if (validated) { for (const part of prefix) await sink.write(part); prefix = []; }
            } else await sink.write(item.value);
          }
        }
      } else {
        const blob = await response.blob();
        J.checkAbort(signal);
        bytes = blob.size;
        const metadata = new Uint8Array(await blob.slice(0, PREFIX_LIMIT).arrayBuffer());
        validated = bytes > 0 && await validPrefix([metadata], metadata.length, bytes, job);
        if (validated) await sink.write(blob);
      }
      if (!validated || !bytes || (expected !== null && expected !== bytes)) throw error('response');
      J.checkAbort(signal);
      return await sink.close();
    } catch (err) {
      J.checkAbort(signal);
      if (err instanceof S.ExportError) throw err;
      throw error('network');
    } finally {
      if (reader) {
        try { await reader.cancel(); } catch (err) { /* network is already closed */ }
        try { reader.releaseLock(); } catch (err) { /* already released */ }
      }
    }
  }

  // Converts a completed silent MP4 without rendering or encoding its video again. On error/cancel no lower bitrate
  // is substituted. The caller owns sink.abort(): standalone export aborts its file; a kit aborts the whole folder.
  async function convert(opts) {
    const o = opts || {}, config = validateConfig(o.audioServer);
    if (!config.token) throw error('auth');
    if (!(o.video instanceof Blob) || !o.video.size) throw error('media');
    const range = SOURCE.rangeOf(o.job, o.audio, error);
    if (o.onProgress) o.onProgress({ phase: 'audioServer', i: 0, N: 0, eta: null });
    const health = o.health || await check(config, { signal: o.signal, fetchImpl: o.fetchImpl });
    if (o.video.size + range.bytes + MULTIPART_MARGIN > health.maxUploadBytes) throw error('too-large');
    const pcm = await audioBlob(o.audio, o.job, o.signal);
    const body = new FormData();
    body.append('video', o.video, 'video.mp4');
    body.append('audio', pcm, 'audio.wav');
    body.append('frames', String(o.job.N));
    body.append('fps', String(o.job.fps));
    const response = await request(config, '/v1/convert', { method: 'POST', signal: o.signal, body,
      headers: { Authorization: 'Bearer ' + config.token, Accept: 'video/mp4' } }, o.fetchImpl);
    let info;
    try { info = resultInfo(response, o.job.N); }
    catch (err) { await cancelBody(response); throw err; }
    const done = await intoSink(response, o.sink, o.signal, o.job);
    return Object.assign({}, done, info);
  }

  // Standalone server-audio MP4: one silent browser encode, then upload the original exact PCM range. Inputs are
  // captured by the export caller. No-song/audio-off exports use the normal local path without any server request.
  async function exportVideo(opts) {
    const o = opts || {}, song = o.audio && o.doc.output.audio ? o.audio : null;
    if (!song) return J.exportVideo(o);
    const started = performance.now(), temporary = SINK.createMemorySink({ name: 'video.mp4', type: 'video/mp4' });
    try {
      const config = validateConfig(o.audioServer);
      if (!config.token) throw error('auth');
      const health = await check(config, { signal: o.signal, fetchImpl: o.fetchImpl });
      const local = await J.exportVideo(Object.assign({}, o, { audio: null, sink: temporary }));
      const plan = o.engine.plan;
      if (!plan) throw new S.ExportError('no-plan', 'the engine has no plan');
      const range = S.exportRange(o.doc, plan);
      const size = S.outputSize(plan.design.aspect, o.doc.output.short);
      const done = await convert({ video: local.blob, audio: song, job: { t0: range.t0, N: local.frames, fps: o.doc.output.fps, w: size.w, h: size.h },
        sink: o.sink, audioServer: config, health, signal: o.signal, onProgress: o.onProgress, fetchImpl: o.fetchImpl });
      return Object.assign({}, local, done, { blob: done.blob, name: o.sink.name || S.fileName(o.doc, 'mp4'), ms: performance.now() - started });
    } catch (err) {
      await o.sink.abort();
      await temporary.abort();
      throw J.exportFailure(err, o.signal, null);
    }
  }

  return { validateConfig, check, convert, exportVideo, audioBlob, TARGET, MULTIPART_MARGIN };
});
