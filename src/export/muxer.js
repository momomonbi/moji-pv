/* 文字PVメーカー v2 — original work. MP4 muxer adapter: the only user of the vendor Mp4Muxer, received by injection (§4.21). */
MV.def('export/muxer', ['export/schedule'], (S) => {
  'use strict';

  // WebCodecs codec string prefix → the muxer's codec name.
  const MUX_CODECS = Object.freeze({ avc1: 'avc', avc3: 'avc', hvc1: 'hevc', hev1: 'hevc', vp09: 'vp9', av01: 'av1',
    mp4a: 'aac', opus: 'opus' });
  const STREAM_CHUNK = 8 * 1024 * 1024;        // the stream target hands over data in pieces of this size
  const BACKLOG_LIMIT = 64 * 1024 * 1024;      // ready() waits for the sink when this much is still unwritten

  // muxCodec('avc1.640028') → 'avc'; throws ExportError('codec') for codecs the muxer cannot hold.
  function muxCodec(codec) {
    const name = MUX_CODECS[String(codec).split('.')[0]];
    if (!name) throw new S.ExportError('codec', 'no MP4 mapping for codec ' + codec);
    return name;
  }

  function checkArgs(o) {
    const lib = o.lib;
    if (!lib || typeof lib.Muxer !== 'function' || typeof lib.ArrayBufferTarget !== 'function' ||
        typeof lib.StreamTarget !== 'function') {
      throw new S.ExportError('args', 'createMuxer: lib must be the Mp4Muxer namespace');
    }
    if (o.target !== 'stream' && o.target !== 'memory') throw new S.ExportError('args', "createMuxer: target is 'stream' or 'memory'");
    if (o.target === 'stream' && typeof o.write !== 'function') throw new S.ExportError('args', 'createMuxer: stream needs write');
    for (const k of ['w', 'h', 'fps']) {
      if (!(Number.isInteger(o[k]) && o[k] > 0)) throw new S.ExportError('args', 'createMuxer: ' + k + ' must be a positive integer');
    }
  }

  // createMuxer({ lib, target: 'stream' | 'memory', write?, w, h, fps, codec = 'avc', audio: { rate, channels, codec = 'aac' } | null })
  //   → { video(chunk, meta), audio(chunk, meta), ready(), finish() → Promise<ArrayBuffer | null>, backlog }
  // 'stream': StreamTarget (fastStart false); every piece goes to write(bytes, position) in order, and pieces may revisit
  // earlier positions (the header sizes are patched at the end). 'memory': ArrayBufferTarget with fastStart 'in-memory';
  // finish() returns the file. Video timestamps use a time scale of `fps`, so frame i lands exactly on i / fps.
  function createMuxer(opts) {
    const o = opts || {};
    checkArgs(o);
    const lib = o.lib;
    let failed = null;
    let pending = Promise.resolve();
    let backlog = 0;
    let finished = false;

    function enqueue(data, position) {
      const copy = data.slice();
      backlog += copy.byteLength;
      pending = pending
        .then(() => (failed ? undefined : o.write(copy, position)))
        .then(() => { backlog -= copy.byteLength; }, (err) => { backlog -= copy.byteLength; failed = failed || err; });
    }

    const target = o.target === 'memory' ? new lib.ArrayBufferTarget()
      : new lib.StreamTarget({ onData: (data, position) => enqueue(data, position), chunked: true, chunkSize: STREAM_CHUNK });
    const options = {
      target,
      video: { codec: o.codec || 'avc', width: o.w, height: o.h, frameRate: o.fps },
      fastStart: o.target === 'memory' ? 'in-memory' : false,
      firstTimestampBehavior: 'cross-track-offset',
    };
    if (o.audio) options.audio = { codec: o.audio.codec || 'aac', numberOfChannels: o.audio.channels, sampleRate: o.audio.rate };
    const mux = new lib.Muxer(options);

    function sinkFailure() { return new S.ExportError('sink', 'writing the file failed: ' + (failed && failed.message), failed); }

    function check() {
      if (finished) throw new S.ExportError('finished', 'muxer: chunk after finish');
      if (failed) throw sinkFailure();
    }

    return {
      video(chunk, meta) { check(); mux.addVideoChunk(chunk, meta); },
      audio(chunk, meta) { check(); mux.addAudioChunk(chunk, meta); },
      async ready() {
        if (backlog > BACKLOG_LIMIT) await pending;
        if (failed) throw sinkFailure();
      },
      async finish() {
        check();
        finished = true;
        mux.finalize();
        await pending;
        if (failed) throw sinkFailure();
        return o.target === 'memory' ? target.buffer : null;
      },
      get backlog() { return backlog; },
    };
  }

  return { MUX_CODECS, muxCodec, createMuxer };
});
