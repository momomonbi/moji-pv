/* 文字PVメーカー v2 — original work. In-browser AAC 320 kbps from original PCM, with one native silent-video encode and lossless video remux. */
MV.def('export/host/audio_local', ['export/schedule', 'export/host/mp4', 'export/host/sink', 'export/host/audio_source', 'export/host/audio_runtime'],
  (S, J, SINK, SOURCE, RUNTIME) => {
    'use strict';

    const TARGET = SOURCE.TARGET;
    const MAX_INPUT_BYTES = RUNTIME.MAX_INPUT_BYTES;
    const MAX_SECONDS = RUNTIME.MAX_SECONDS;

    function error(code) { return new S.ExportError('audio-local-' + code, 'local audio conversion ' + code); }

    function runtimeOf(o) {
      const runtime = o.runtime || (o.audioLocal && typeof o.audioLocal === 'object' ? o.audioLocal : RUNTIME);
      if (!runtime || typeof runtime.convert !== 'function') throw error('unavailable');
      return runtime;
    }

    function checkSize(video, audio, job) {
      const range = SOURCE.rangeOf(job, audio, error);
      if (job.N / job.fps > MAX_SECONDS || range.bytes > MAX_INPUT_BYTES
        || (video && video.size + range.bytes > MAX_INPUT_BYTES)) throw error('too-large');
      return range;
    }

    // Loading happens before the potentially expensive native video pass. The runtime caches its core assets; each
    // conversion owns a worker whose memory is released on success, failure or cancellation.
    async function prepare(opts) {
      const o = opts || {}, runtime = runtimeOf(o);
      J.checkAbort(o.signal);
      J.reportProcess(o, { stage: 'audioLoading', backend: 'ffmpeg', audioSource: 'local', audioCodec: 'mp4a.40.2' });
      if (o.onProgress) o.onProgress({ phase: 'audioLocalLoading', i: 0, N: 0, eta: null });
      try {
        if (runtime.prepare) await runtime.prepare({ signal: o.signal, onProgress: o.onProgress });
      } catch (err) {
        J.checkAbort(o.signal);
        if (err instanceof S.ExportError) throw err;
        throw error('load');
      }
      J.checkAbort(o.signal);
      return runtime;
    }

    // Convert a completed silent MP4 and its matching original PCM. No native AudioEncoder and no server requests:
    // FFmpeg's own MP4 edit lists retain AAC priming while `-c:v copy` retains every encoded video sample.
    async function convert(opts) {
      const o = opts || {}, runtime = runtimeOf(o);
      J.checkAbort(o.signal);
      if (!(o.video instanceof Blob) || !o.video.size) throw error('media');
      checkSize(o.video, o.audio, o.job);
      J.reportProcess(o, { stage: 'audioPrepare', backend: 'ffmpeg', audioSource: 'local', audioCodec: 'mp4a.40.2',
        audioExecution: 'cpu', audioThreads: 1, videoCopy: true, temporary: false });
      if (o.onProgress) o.onProgress({ phase: 'audioLocal', i: 0, N: 0, eta: null });
      const pcm = await SOURCE.audioBlob(o.audio, o.job, o.signal, error);
      let converted;
      try {
        J.reportProcess(o, { stage: 'audio', backend: 'ffmpeg' });
        converted = await runtime.convert({ video: o.video, audio: pcm, frames: o.job.N, fps: o.job.fps,
          signal: o.signal, onProgress: o.onProgress });
      } catch (err) {
        J.checkAbort(o.signal);
        if (err instanceof S.ExportError) throw err;
        throw error('convert');
      }
      J.checkAbort(o.signal);
      if (!converted || !(converted.blob instanceof Blob) || !converted.blob.size) throw error('response');
      const measured = converted.measuredBitrate === undefined || converted.measuredBitrate === null ? null : converted.measuredBitrate;
      if (measured !== null && (!Number.isFinite(measured) || measured <= 0)) throw error('response');
      J.reportProcess(o, { stage: 'finalize', backend: 'ffmpeg' });
      await SOURCE.validateBlob(converted.blob, o.job, o.signal, error);
      J.checkAbort(o.signal);
      J.reportProcess(o, { stage: 'save' });
      await o.sink.write(converted.blob);
      J.checkAbort(o.signal);
      const done = await o.sink.close();
      return Object.assign({}, done, { audio: true, audioCodec: 'mp4a.40.2', audioBitrate: TARGET,
        audioBitrateMode: null, audioSource: 'local', audioMeasuredBitrate: measured });
    }

    async function exportVideo(opts) {
      const o = opts || {}, song = o.audio && o.doc.output.audio ? o.audio : null;
      if (!song && S.usesLocalAudio(o.doc)) {
        await o.sink.abort();
        throw error('media');
      }
      if (!song) return J.exportVideo(o);
      const started = performance.now(), temporary = SINK.createMemorySink({ name: 'video.mp4', type: 'video/mp4' });
      try {
        const plan = o.engine.plan;
        if (!plan) throw new S.ExportError('no-plan', 'the engine has no plan');
        const range = S.exportRange(o.doc, plan), size = S.outputSize(plan.design.aspect, o.doc.output.short);
        const job = { t0: range.t0, N: S.frameCount(range.t1 - range.t0, o.doc.output.fps), fps: o.doc.output.fps, w: size.w, h: size.h };
        if (!job.N) throw new S.ExportError('range-empty', 'nothing to export');
        checkSize(null, song, job);
        const runtime = await prepare(o);
        const video = await J.exportVideo(Object.assign({}, o, { audio: null, sink: temporary, temporary: true }));
        job.N = video.frames;
        const done = await convert({ video: video.blob, audio: song, job, sink: o.sink, runtime,
          signal: o.signal, onProgress: o.onProgress, onProcess: o.onProcess });
        return Object.assign({}, video, done, { blob: done.blob, name: o.sink.name || S.fileName(o.doc, 'mp4'), ms: performance.now() - started });
      } catch (err) {
        await o.sink.abort();
        await temporary.abort();
        throw J.exportFailure(err, o.signal, null);
      }
    }

    return { prepare, convert, exportVideo, TARGET, MAX_INPUT_BYTES, MAX_SECONDS };
  });
