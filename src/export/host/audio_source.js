/* 文字PVメーカー v2 — original work. Original PCM range and converted-MP4 validation shared by local and server AAC conversion. */
MV.def('export/host/audio_source', ['export/schedule', 'export/host/mp4', 'audio/wav', 'media/isobmff'], (S, J, WAV, ISO) => {
  'use strict';

  const RATE = 48000;
  const TARGET = 320000;
  const WAV_BLOCK = 1 << 20;
  const failure = (code) => new S.ExportError('audio-source-' + code, 'audio source ' + code);

  function rangeOf(job, song, error = failure) {
    if (!job || !Number.isSafeInteger(job.N) || job.N <= 0 || ![24, 30, 60].includes(job.fps)
      || !Number.isFinite(job.t0) || job.t0 < 0 || !song || song.sampleRate !== RATE
      || !Number.isSafeInteger(song.numberOfChannels) || song.numberOfChannels <= 0 || typeof song.getChannelData !== 'function') {
      throw error('media');
    }
    const frames = S.audioFrames(job.N, job.fps, RATE);
    if (!Number.isSafeInteger(frames) || frames * 4 + WAV.HEADER_BYTES > 0xffffffff) throw error('too-large');
    return { frames, start: Math.round(job.t0 * RATE), bytes: WAV.HEADER_BYTES + frames * 4 };
  }

  // Exact N/fps, stereo, 48 kHz PCM16 from the original decoded song. Match the native encoder's downmix/trim/padding;
  // never decode an already compressed export. Yield between bounded pieces so long songs remain cancellable.
  async function audioBlob(song, job, signal, error = failure) {
    const range = rangeOf(job, song, error), channels = J.channelsOf(song);
    const parts = [WAV.pcm16Header(RATE, range.frames, 2)];
    for (let from = 0; from < range.frames; from += WAV_BLOCK) {
      J.checkAbort(signal);
      parts.push(WAV.pcm16Data(channels, range.start + from, Math.min(WAV_BLOCK, range.frames - from), 2));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    J.checkAbort(signal);
    return new Blob(parts, { type: 'audio/wav' });
  }

  function validateMovie(movie, job, error = failure) {
    const videos = movie.tracks.filter((t) => t.kind === 'video'), audios = movie.tracks.filter((t) => t.kind === 'audio');
    const video = videos[0];
    if (!video || videos.length !== 1 || audios.length !== 1 || audios[0].fourcc !== 'mp4a'
      || !['avc1', 'avc3'].includes(video.fourcc) || !video.table || video.table.n !== job.N
      || Math.abs(video.table.duration - job.N / job.fps) > 2e-5
      || (job.w && video.w !== job.w) || (job.h && video.h !== job.h)) throw error('response');
    return movie;
  }

  // Blob slices read only the container headers/sample tables; mdat remains in its existing backing store.
  async function validateBlob(blob, job, signal, error = failure) {
    J.checkAbort(signal);
    if (!(blob instanceof Blob) || blob.size < 24) throw error('response');
    let movie;
    try {
      movie = await ISO.parse(async (offset, length) => {
        J.checkAbort(signal);
        return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
      }, blob.size);
    } catch (err) { J.checkAbort(signal); throw error('response'); }
    J.checkAbort(signal);
    return validateMovie(movie, job, error);
  }

  return { RATE, TARGET, rangeOf, audioBlob, validateMovie, validateBlob };
});
