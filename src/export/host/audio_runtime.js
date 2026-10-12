/* 文字PVメーカー v2 — original work. Verified, self-hosted FFmpeg WASM in a disposable worker; original PCM → AAC320 without uploading media. */
MV.def('export/host/audio_runtime', ['export/schedule', 'export/host/mp4'], (S, J) => {
  'use strict';

  const VERSION = '0.12.10';
  const MAX_INPUT_BYTES = 256 * 1024 * 1024, MAX_SECONDS = 3600;
  const LIMITS = Object.freeze({ maxInputBytes: MAX_INPUT_BYTES, maxSeconds: MAX_SECONDS, maxOutputBytes: 260 * 1024 * 1024 });
  const ASSETS = Object.freeze([
    Object.freeze({ name: 'ffmpeg-core.js', bytes: 112059, hash: 'b266ab5b952555881dd6310663986994a182acb2b7ff25cf10a25f7a37ac2b21' }),
    Object.freeze({ name: 'ffmpeg-core.wasm', bytes: 32232419, hash: '9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7' }),
  ]);
  const CORE_BYTES = ASSETS.reduce((n, a) => n + a.bytes, 0);
  const CACHE_NAME = 'moji-pv-ffmpeg-core-' + VERSION;
  const JOB_TIMEOUT = 30 * 60 * 1000;
  let assets = null, loading = null, active = false;

  function error(code) { return new S.ExportError('audio-local-' + code, 'local audio conversion ' + code); }
  function cancelled() { return new S.ExportError('cancelled', 'export cancelled'); }
  function support() {
    const ok = typeof Worker === 'function' && typeof Blob === 'function' && typeof fetch === 'function'
      && typeof URL === 'function' && typeof URL.createObjectURL === 'function'
      && typeof WebAssembly === 'object' && typeof WebAssembly.compile === 'function'
      && typeof crypto === 'object' && crypto.subtle && typeof crypto.subtle.digest === 'function';
    return { supported: !!ok, reason: ok ? null : 'unavailable', maxInputBytes: MAX_INPUT_BYTES,
      maxSeconds: MAX_SECONDS, coreBytes: CORE_BYTES, cached: !!assets };
  }

  function baseURL() {
    const href = typeof location === 'object' && location.href ? location.href : 'https://momomonbi.github.io/moji-pv/';
    if (new URL(href).protocol === 'file:') return 'https://momomonbi.github.io/moji-pv/vendor/ffmpeg/';
    return new URL(MV.ASSET_BASE || 'vendor/ffmpeg/', href).href;
  }

  function progress(fn, phase, i, N) {
    if (fn) fn({ phase, i, N, eta: null });
  }

  async function digest(bytes, signal) {
    J.checkAbort(signal);
    const value = await crypto.subtle.digest('SHA-256', bytes);
    J.checkAbort(signal);
    return Array.from(new Uint8Array(value), (v) => v.toString(16).padStart(2, '0')).join('');
  }

  async function verify(bytes, spec, signal) {
    return bytes.byteLength === spec.bytes && await digest(bytes, signal) === spec.hash;
  }

  async function persistentCache() {
    try { return typeof caches === 'object' && caches ? await caches.open(CACHE_NAME) : null; }
    catch (err) { return null; } // Storage may be disabled; verified downloads still work.
  }

  async function readAsset(response, spec, signal, onChunk) {
    if (!response || !response.ok) throw error('load');
    const chunks = [], reader = response.body && response.body.getReader ? response.body.getReader() : null;
    let total = 0;
    try {
      if (reader) {
        while (true) {
          J.checkAbort(signal);
          const part = await reader.read();
          J.checkAbort(signal);
          if (part.done) break;
          total += part.value.byteLength;
          if (total > spec.bytes) throw error('load');
          chunks.push(part.value); onChunk(part.value.byteLength);
        }
        const out = new Uint8Array(total);
        let at = 0;
        for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
        return out.buffer;
      }
      const bytes = await response.arrayBuffer();
      J.checkAbort(signal);
      if (bytes.byteLength > spec.bytes) throw error('load');
      onChunk(bytes.byteLength);
      return bytes;
    } finally {
      if (reader) {
        try { await reader.cancel(); } catch (err) { /* Closed or already aborted. */ }
        reader.releaseLock();
      }
    }
  }

  async function loadAssets(signal, notify) {
    const cache = await persistentCache(), base = baseURL(), values = [];
    let received = 0;
    notify({ phase: 'audioLocalLoading', i: 0, N: CORE_BYTES, eta: null });
    for (const spec of ASSETS) {
      J.checkAbort(signal);
      const url = new URL(spec.name, base).href;
      let bytes = null;
      if (cache) {
        try {
          const hit = await cache.match(url);
          if (hit) {
            const value = await readAsset(hit, spec, signal, () => {});
            if (await verify(value, spec, signal)) {
              bytes = value; received += value.byteLength;
              notify({ phase: 'audioLocalLoading', i: received, N: CORE_BYTES, eta: null });
            } else await cache.delete(url);
          }
        } catch (err) {
          J.checkAbort(signal);
          try { await cache.delete(url); } catch (ignore) { /* Optional cache. */ }
        } // Re-fetch stale/corrupt/unreadable cache entries.
      }
      if (!bytes) {
        const response = await fetch(url, { signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'force-cache' });
        bytes = await readAsset(response, spec, signal, (n) => {
          received += n; notify({ phase: 'audioLocalLoading', i: received, N: CORE_BYTES, eta: null });
        });
        if (!await verify(bytes, spec, signal)) throw error('load');
        if (cache) {
          try { await cache.put(url, new Response(bytes, { headers: { 'Content-Type': spec.name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' } })); }
          catch (err) { /* Storage limits do not prevent conversion. */ }
        }
      }
      values.push(bytes);
    }
    J.checkAbort(signal);
    // Fail before rendering if this browser/CSP cannot compile the core's WASM features.
    await WebAssembly.compile(values[1]);
    J.checkAbort(signal);
    const js = new TextDecoder('utf-8', { fatal: true }).decode(values[0]);
    return { js, wasm: values[1] };
  }

  function prepare(opts) {
    const o = opts || {};
    try { J.checkAbort(o.signal); } catch (err) { return Promise.reject(err); }
    if (!support().supported) return Promise.reject(error('unavailable'));
    if (assets) {
      progress(o.onProgress, 'audioLocalLoading', CORE_BYTES, CORE_BYTES);
      return Promise.resolve({ version: VERSION, bytes: CORE_BYTES, cached: true });
    }
    if (!loading) {
      const task = { controller: new AbortController(), users: new Set(), last: null, promise: null };
      loading = task;
      task.promise = loadAssets(task.controller.signal, (p) => {
        task.last = p;
        for (const user of task.users) if (user.progress) user.progress(p);
      }).then((value) => { J.checkAbort(task.controller.signal); assets = value; return value; })
        .catch((err) => {
          J.checkAbort(task.controller.signal);
          if (err && err.code && err.code.startsWith('audio-local-')) throw err;
          throw error(err instanceof RangeError ? 'memory' : 'load');
        }).finally(() => { if (loading === task) loading = null; });
    }
    const task = loading;
    return new Promise((resolve, reject) => {
      const user = { progress: o.onProgress }, signal = o.signal;
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true; task.users.delete(user);
        if (signal) signal.removeEventListener('abort', abort);
        if (err) reject(err); else resolve({ version: VERSION, bytes: CORE_BYTES, cached: true });
      };
      const abort = () => {
        finish(cancelled());
        if (!task.users.size) { task.controller.abort(); if (loading === task) loading = null; }
      };
      task.users.add(user);
      if (signal) signal.addEventListener('abort', abort, { once: true });
      if (task.last && user.progress) user.progress(task.last);
      task.promise.then(() => finish(null), finish);
      if (signal && signal.aborted) abort();
    });
  }

  // This bridge and its controller are original MIT code. Only the separate, pinned FFmpeg core is GPL; source and
  // licence notices are served beside the core. The worker receives immutable Blob references via WORKERFS.
  function workerMain() {
    let core = null, running = false, memoryIssue = false;
    const sendError = (code) => self.postMessage({ kind: 'error', code });
    self.onmessage = async (event) => {
      const data = event.data || {};
      try {
        if (data.kind === 'init') {
          if (core || running || typeof FileReaderSync !== 'function') { sendError('unavailable'); return; }
          core = await createFFmpegCore({ wasmBinary: data.wasm });
          core.setLogger(({ message }) => { if (/memory|allocation|enlarge|out of bounds/i.test(message)) memoryIssue = true; });
          if (!core.FS.filesystems.WORKERFS) { sendError('unavailable'); return; }
          self.postMessage({ kind: 'ready' }); return;
        }
        if (data.kind !== 'convert' || !core || running) { sendError('response'); return; }
        running = true;
        const FS = core.FS;
        FS.mkdir('/input');
        FS.mount(FS.filesystems.WORKERFS, { blobs: [
          { name: 'video.mp4', data: data.video }, { name: 'audio.wav', data: data.audio },
        ] }, '/input');
        core.setProgress(({ progress }) => {
          if (Number.isFinite(progress)) self.postMessage({ kind: 'progress', ratio: Math.max(0, Math.min(1, progress)) });
        });
        core.setTimeout(30 * 60 * 1000);
        const duration = (data.frames / data.fps).toFixed(12);
        const ret = core.exec('-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file',
          '-f', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0', '-i', '/input/video.mp4',
          '-protocol_whitelist', 'file', '-f', 'wav', '-i', '/input/audio.wav',
          '-map', '0:v:0', '-map', '1:a:0', '-map_metadata', '-1', '-map_chapters', '-1',
          '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-ac', '2',
          '-af', 'apad=whole_dur=' + duration + ',atrim=duration=' + duration + ',asetpts=PTS-STARTPTS',
          '-movflags', '+faststart', '-movie_timescale', '48000', '-use_editlist', '1', '-shortest', '/output.mp4');
        if (ret !== 0) { sendError(memoryIssue ? 'memory' : 'convert'); return; }
        const size = FS.stat('/output.mp4').size;
        if (!Number.isSafeInteger(size) || size <= 0 || size > data.maxOutputBytes) { sendError('too-large'); return; }
        core.reset();
        // This pinned core's ffprobe wrapper does not update Module.ret (it remains -1 after reset). Require the
        // generated JSON and exact stream metadata instead of treating that wrapper value as a process exit code.
        core.ffprobe('-v', 'error', '-show_entries', 'stream=codec_type,codec_name,sample_rate,channels,start_time,duration,bit_rate,nb_frames',
          '-of', 'json', '-o', '/result.json', '/output.mp4');
        const info = JSON.parse(FS.readFile('/result.json', { encoding: 'utf8' }));
        const streams = info.streams || [], video = streams.filter((s) => s.codec_type === 'video'), audio = streams.filter((s) => s.codec_type === 'audio');
        const a = audio[0], v = video[0], seconds = data.frames / data.fps;
        if (video.length !== 1 || audio.length !== 1 || v.codec_name !== 'h264' || Number(v.nb_frames) !== data.frames
          || ![v.start_time, v.duration, a.start_time, a.duration].every((n) =>
            (typeof n === 'number' || (typeof n === 'string' && n.trim() !== '')) && Number.isFinite(Number(n)))
          || Math.abs(Number(v.start_time)) > .0001 || Math.abs(Number(v.duration) - seconds) > .002
          || a.codec_name !== 'aac' || Number(a.sample_rate) !== 48000 || Number(a.channels) !== 2
          || Math.abs(Number(a.start_time)) > .0001 || Math.abs(Number(a.duration) - seconds) > 1 / 48000) { sendError('response'); return; }
        const rate = Number(a.bit_rate), bytes = FS.readFile('/output.mp4');
        FS.unlink('/output.mp4'); FS.unlink('/result.json'); FS.unmount('/input'); FS.rmdir('/input');
        self.postMessage({ kind: 'done', bytes: bytes.buffer, measuredBitrate: Number.isFinite(rate) && rate > 0 ? rate : null }, [bytes.buffer]);
      } catch (err) {
        const message = err && err.message ? err.message : '';
        sendError(/memory|allocation|enlarge|out of bounds/i.test(message) || (err && err.name === 'RangeError') ? 'memory' : core ? 'convert' : 'load');
      }
    };
  }

  async function convert(opts) {
    const o = opts || {};
    J.checkAbort(o.signal);
    if (!support().supported) throw error('unavailable');
    if (active) throw error('busy');
    if (!(o.video instanceof Blob) || !(o.audio instanceof Blob) || o.video.size <= 0 || o.audio.size <= 44
      || !Number.isSafeInteger(o.frames) || o.frames <= 0 || ![24, 25, 30, 50, 60].includes(o.fps)
      || o.frames > o.fps * MAX_SECONDS) throw error('media');
    if (o.video.size + o.audio.size > MAX_INPUT_BYTES) throw error('too-large');
    active = true;
    let worker = null, url = null;
    try {
      await prepare(o);
      J.checkAbort(o.signal);
      url = URL.createObjectURL(new Blob([assets.js, '\n(', workerMain.toString(), ')();\n'], { type: 'text/javascript' }));
      try { worker = new Worker(url); } catch (err) { throw error('load'); }
      return await new Promise((resolve, reject) => {
        let settled = false, ready = false;
        const signal = o.signal;
        const finish = (err, value) => {
          if (settled) return;
          settled = true; clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', abort);
          worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
          if (err) reject(err); else resolve(value);
        };
        const abort = () => finish(cancelled());
        const send = (data) => {
          try { worker.postMessage(data); }
          catch (err) { finish(error(err instanceof RangeError ? 'memory' : 'convert')); }
        };
        const timer = setTimeout(() => finish(error('convert')), JOB_TIMEOUT);
        if (signal) signal.addEventListener('abort', abort, { once: true });
        worker.onerror = (event) => {
          if (event && event.preventDefault) event.preventDefault();
          finish(error(ready ? 'convert' : 'load'));
        };
        worker.onmessageerror = () => finish(error('response'));
        worker.onmessage = (event) => {
          try {
            if (settled) return;
            const data = event.data || {};
            if (signal && signal.aborted) { abort(); return; }
            if (data.kind === 'ready' && !ready) {
              ready = true; progress(o.onProgress, 'audioLocal', 0, o.frames);
              if (settled || (signal && signal.aborted)) return;
              send({ kind: 'convert', video: o.video, audio: o.audio, frames: o.frames, fps: o.fps, maxOutputBytes: LIMITS.maxOutputBytes });
            } else if (data.kind === 'progress' && ready) {
              if (Number.isFinite(data.ratio)) progress(o.onProgress, 'audioLocal', Math.round(Math.max(0, Math.min(1, data.ratio)) * o.frames), o.frames);
            } else if (data.kind === 'done' && ready) {
              if (!(data.bytes instanceof ArrayBuffer) || !data.bytes.byteLength || data.bytes.byteLength > LIMITS.maxOutputBytes
                || (data.measuredBitrate !== null && (!Number.isFinite(data.measuredBitrate) || data.measuredBitrate <= 0))) { finish(error('response')); return; }
              progress(o.onProgress, 'audioLocal', o.frames, o.frames);
              if (settled || (signal && signal.aborted)) return;
              finish(null, { blob: new Blob([data.bytes], { type: 'video/mp4' }), measuredBitrate: data.measuredBitrate });
            } else if (data.kind === 'error') {
              const code = ['unavailable', 'load', 'memory', 'too-large', 'convert', 'response'].includes(data.code) ? data.code : 'convert';
              finish(error(code));
            } else finish(error('response'));
          } catch (err) { finish(error(err instanceof RangeError ? 'memory' : 'convert')); }
        };
        try {
          progress(o.onProgress, 'audioLocalLoading', CORE_BYTES, CORE_BYTES);
          if (settled || (signal && signal.aborted)) return;
          send({ kind: 'init', wasm: assets.wasm });
          if (signal && signal.aborted) abort();
        } catch (err) { finish(error(err instanceof RangeError ? 'memory' : 'convert')); }
      });
    } catch (err) {
      J.checkAbort(o.signal);
      if (err && err.code) throw err;
      throw error(err instanceof RangeError ? 'memory' : 'convert');
    } finally {
      if (worker) worker.terminate();
      if (url) URL.revokeObjectURL(url);
      active = false;
    }
  }

  return { prepare, convert, support, LIMITS, MAX_INPUT_BYTES, MAX_SECONDS, CORE_BYTES, ASSETS, VERSION, baseURL };
});
