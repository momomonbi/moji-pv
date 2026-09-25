/* 文字PVメーカー v2 — original work. WebM (Matroska) writer: VP9/VP8 video with alpha in BlockAdditions, Opus audio, cues (DESIGN_2_1 §13.5). */
MV.def('export/webm', ['export/schedule'], (S) => {
  'use strict';

  // Matroska / WebM element ids, marker bits included (the bytes as written).
  const IDS = Object.freeze({
    EBML: 0x1a45dfa3, EBMLVersion: 0x4286, EBMLReadVersion: 0x42f7, EBMLMaxIDLength: 0x42f2, EBMLMaxSizeLength: 0x42f3,
    DocType: 0x4282, DocTypeVersion: 0x4287, DocTypeReadVersion: 0x4285,
    Void: 0xec,
    Segment: 0x18538067,
    SeekHead: 0x114d9b74, Seek: 0x4dbb, SeekID: 0x53ab, SeekPosition: 0x53ac,
    Info: 0x1549a966, TimestampScale: 0x2ad7b1, Duration: 0x4489, MuxingApp: 0x4d80, WritingApp: 0x5741,
    Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackUID: 0x73c5, TrackType: 0x83, FlagLacing: 0x9c,
    CodecID: 0x86, CodecPrivate: 0x63a2, CodecDelay: 0x56aa, SeekPreRoll: 0x56bb, DefaultDuration: 0x23e383,
    MaxBlockAdditionID: 0x55ee, BlockAdditionMapping: 0x41e4, BlockAddIDValue: 0x41f0, BlockAddIDType: 0x41e7,
    Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba, AlphaMode: 0x53c0,
    Audio: 0xe1, SamplingFrequency: 0xb5, Channels: 0x9f,
    Cluster: 0x1f43b675, Timestamp: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1,
    BlockAdditions: 0x75a1, BlockMore: 0xa6, BlockAddID: 0xee, BlockAdditional: 0xa5, ReferenceBlock: 0xfb,
    Cues: 0x1c53bb6b, CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7, CueTrack: 0xf7, CueClusterPosition: 0xf1,
  });

  const CODECS = Object.freeze(['V_VP9', 'V_VP8']);
  const APP = 'mojipv 2.1';
  const TIMESTAMP_SCALE = 1000000;          // ns per tick: every time in the file is in milliseconds
  const MAX_RELATIVE = 32767;               // a block's time relative to its cluster is an int16 (ms)
  const SEEK_AREA = 96;                     // SeekHead plus Void; finish() rewrites the whole area in place
  const UNKNOWN_SIZE = Object.freeze([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);   // the Segment's size until finish()
  const VIDEO_TRACK = 1;
  const AUDIO_TRACK = 2;
  const ALPHA_ADD_ID = 1;                   // BlockAddID of the alpha frame (VP8/VP9 alpha, AlphaMode 1)
  const KEY_FLAG = 0x80;                    // SimpleBlock flags: key frame, no lacing
  const OPUS_MAGIC = 'OpusHead';
  const OPUS_PRE_SKIP = 312;                // samples at 48 kHz, when the encoder gives no OpusHead
  const OPUS_CLOCK = 48000;                 // Opus pre-skip is always counted at 48 kHz
  const SEEK_PRE_ROLL_NS = 80000000;        // 80 ms, as the WebM Opus mapping asks
  const COMPACT_AFTER = 1024;               // the audio queue drops its consumed head once this many are taken

  function argsError(message) { return new S.ExportError('args', 'webm: ' + message); }

  // --- EBML encoding --------------------------------------------------------------------------------------------

  // ebmlId(id) → the id's 1–4 bytes: ebmlId(0x1a45dfa3) → 1A 45 DF A3. The id carries its own length marker; an id
  // without a valid marker, or with all data bits set (reserved), throws ExportError('args').
  function ebmlId(id) {
    const n = id > 0xffffff ? 4 : id > 0xffff ? 3 : id > 0xff ? 2 : 1;
    if (!Number.isInteger(id) || Math.floor(id / 2 ** (7 * n)) !== 1 || id === 2 ** (7 * n + 1) - 1) {
      throw argsError('bad element id ' + id);
    }
    const out = new Uint8Array(n);
    for (let k = n - 1, v = id; k >= 0; k--, v = Math.floor(v / 256)) out[k] = v % 256;
    return out;
  }

  // ebmlSize(n, width?) → the data size n as an EBML variable-length integer: the shortest form (1–8 bytes), or exactly
  // `width` bytes. Each width's all-ones value means "unknown size", so 127 needs 2 bytes and 16383 needs 3.
  function ebmlSize(n, width) {
    if (!Number.isSafeInteger(n) || n < 0) throw argsError('bad element size ' + n);
    let w = 1;
    while (w < 8 && n > 2 ** (7 * w) - 2) w++;
    if (width !== undefined) {
      if (!(Number.isInteger(width) && width >= w && width <= 8)) throw argsError('size ' + n + ' does not fit ' + width + ' bytes');
      w = width;
    }
    const out = new Uint8Array(w);
    for (let k = w - 1, v = n; k >= 0; k--, v = Math.floor(v / 256)) out[k] = v % 256;
    out[0] |= 0x80 >> (w - 1);
    return out;
  }

  const ID = {};                            // name → id bytes, made once (typed arrays cannot be frozen; never exported)
  for (const name of Object.keys(IDS)) ID[name] = ebmlId(IDS[name]);

  function concat(parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }

  function el(name, ...children) {
    const body = concat(children);
    return concat([ID[name], ebmlSize(body.length), body]);
  }

  // Unsigned integers: big-endian, the fewest bytes (at least one).
  function uintBytes(v) {
    let n = 1;
    while (n < 8 && v >= 2 ** (8 * n)) n++;
    const out = new Uint8Array(n);
    for (let k = n - 1, x = v; k >= 0; k--, x = Math.floor(x / 256)) out[k] = x % 256;
    return out;
  }

  // Signed integers: two's complement, big-endian, the fewest bytes (ReferenceBlock).
  function intBytes(v) {
    let n = 1;
    while (n < 8 && (v < -(2 ** (8 * n - 1)) || v >= 2 ** (8 * n - 1))) n++;
    const out = new Uint8Array(n);
    for (let k = n - 1, x = v < 0 ? v + 2 ** (8 * n) : v; k >= 0; k--, x = Math.floor(x / 256)) out[k] = x % 256;
    return out;
  }

  function f64(x) {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setFloat64(0, x, false);
    return out;
  }

  function ascii(s) { return Uint8Array.from(s, (ch) => ch.charCodeAt(0)); }

  const uint = (name, v) => el(name, uintBytes(v));
  const float = (name, x) => el(name, f64(x));
  const str = (name, s) => el(name, ascii(s));
  const bin = (name, bytes) => el(name, bytes);

  // A Void element of exactly `total` bytes (≥ 2): its id, the shortest size field that makes the total, zeros.
  function voidOf(total) {
    let w = 1;
    while (total - 1 - w > 2 ** (7 * w) - 2) w++;
    const out = new Uint8Array(total);
    out.set(ID.Void, 0);
    out.set(ebmlSize(total - 1 - w, w), 1);
    return out;
  }

  // --- inputs -----------------------------------------------------------------------------------------------------

  // A copy of a frame's bytes: a Uint8Array, an ArrayBuffer or view, or an encoded chunk (anything with byteLength and
  // copyTo, such as EncodedVideoChunk and EncodedAudioChunk). The caller may reuse its buffer after the call.
  function bytesOf(data, what) {
    let out = null;
    if (data instanceof ArrayBuffer) out = new Uint8Array(data.slice(0));
    else if (ArrayBuffer.isView(data)) out = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    else if (data && typeof data.copyTo === 'function' && Number.isInteger(data.byteLength)) {
      out = new Uint8Array(data.byteLength);
      data.copyTo(out);
    }
    if (!out) throw argsError(what + ' must be bytes or an encoded chunk');
    if (!out.length) throw argsError(what + ' is empty');
    return out;
  }

  // The duration an encoded chunk carries (µs), or null for plain bytes.
  function chunkDuration(data) {
    const d = data && !ArrayBuffer.isView(data) && !(data instanceof ArrayBuffer) ? data.duration : null;
    return typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : null;
  }

  function checkTime(ts, what) {
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts < 0) throw argsError(what + ' timestamp must be a number ≥ 0 (µs)');
    return ts;
  }

  // The OpusHead to store as CodecPrivate: the encoder's (decoderConfig.description), checked, or one built for
  // channel mapping family 0 (1 or 2 channels): version 1, pre-skip 312, the input rate, gain 0.
  function opusHead(audio) {
    if (audio.codecPrivate !== undefined && audio.codecPrivate !== null) {
      const head = bytesOf(audio.codecPrivate, 'audio.codecPrivate');
      const magic = String.fromCharCode(...head.subarray(0, 8));
      if (head.length < 19 || magic !== OPUS_MAGIC) throw argsError('audio.codecPrivate must be an OpusHead');
      if (head[9] !== audio.channels) throw argsError('the OpusHead has ' + head[9] + ' channels, not ' + audio.channels);
      return head;
    }
    if (audio.channels > 2) throw argsError('more than 2 Opus channels need the encoder\'s OpusHead');
    const head = new Uint8Array(19);
    const v = new DataView(head.buffer);
    head.set(ascii(OPUS_MAGIC), 0);
    head[8] = 1;                                  // version
    head[9] = audio.channels;
    v.setUint16(10, OPUS_PRE_SKIP, true);
    v.setUint32(12, Math.round(audio.rate), true);
    v.setInt16(16, 0, true);                      // output gain
    head[18] = 0;                                 // channel mapping family
    return head;
  }

  function checkOptions(opts) {
    const o = opts || {};
    if (typeof o.write !== 'function') throw argsError('write must be a function');
    for (const k of ['w', 'h']) if (!(Number.isInteger(o[k]) && o[k] > 0)) throw argsError(k + ' must be a positive integer');
    if (!(typeof o.fps === 'number' && Number.isFinite(o.fps) && o.fps > 0)) throw argsError('fps must be a positive number');
    const video = o.video || {};
    if (!CODECS.includes(video.codec)) throw argsError("video.codec is 'V_VP9' or 'V_VP8'");
    let audio = null;
    if (o.audio) {
      const a = o.audio;
      if (!(typeof a.rate === 'number' && Number.isFinite(a.rate) && a.rate > 0)) throw argsError('audio.rate must be a positive number');
      if (!(Number.isInteger(a.channels) && a.channels >= 1 && a.channels <= 255)) throw argsError('audio.channels must be 1–255');
      const head = opusHead(a);
      audio = { rate: a.rate, channels: a.channels, head, preSkip: head[10] | (head[11] << 8) };
    }
    return { write: o.write, w: o.w, h: o.h, fps: o.fps, codec: video.codec, alpha: video.alpha === true, audio };
  }

  // --- header elements ----------------------------------------------------------------------------------------------

  function ebmlHeader() {
    return el('EBML', uint('EBMLVersion', 1), uint('EBMLReadVersion', 1), uint('EBMLMaxIDLength', 4),
      uint('EBMLMaxSizeLength', 8), str('DocType', 'webm'), uint('DocTypeVersion', 4), uint('DocTypeReadVersion', 2));
  }

  // Info with a Duration of 0, and where the Duration's 8 value bytes sit inside it (finish() patches them).
  function infoElement() {
    const scale = uint('TimestampScale', TIMESTAMP_SCALE);
    const children = [scale, float('Duration', 0), str('MuxingApp', APP), str('WritingApp', APP)];
    const bytes = el('Info', ...children);
    const bodyAt = bytes.length - size(children);
    return { bytes, durationAt: bodyAt + scale.length + ID.Duration.length + 1 };   // + the Duration's 1-byte size field
  }

  function videoEntry(o) {
    const parts = [uint('TrackNumber', VIDEO_TRACK), uint('TrackUID', VIDEO_TRACK), uint('TrackType', 1), uint('FlagLacing', 0),
      str('CodecID', o.codec), uint('DefaultDuration', Math.round(1e9 / o.fps))];
    const video = [uint('PixelWidth', o.w), uint('PixelHeight', o.h)];
    if (o.alpha) {
      parts.push(uint('MaxBlockAdditionID', ALPHA_ADD_ID),
        el('BlockAdditionMapping', uint('BlockAddIDValue', ALPHA_ADD_ID), uint('BlockAddIDType', 0)));
      video.push(uint('AlphaMode', 1));
    }
    parts.push(el('Video', ...video));
    return el('TrackEntry', ...parts);
  }

  function audioEntry(a) {
    return el('TrackEntry', uint('TrackNumber', AUDIO_TRACK), uint('TrackUID', AUDIO_TRACK), uint('TrackType', 2),
      uint('FlagLacing', 0), str('CodecID', 'A_OPUS'), bin('CodecPrivate', a.head),
      uint('CodecDelay', Math.round((a.preSkip * 1e9) / OPUS_CLOCK)), uint('SeekPreRoll', SEEK_PRE_ROLL_NS),
      el('Audio', float('SamplingFrequency', a.rate), uint('Channels', a.channels)));
  }

  // The SeekHead for `entries` ([name, position in the segment]), padded with Void to SEEK_AREA bytes. Three entries
  // take at most 68 bytes, so the Void is never shorter than its 2-byte minimum.
  function seekArea(entries) {
    const head = el('SeekHead', ...entries.map(([name, pos]) => el('Seek', bin('SeekID', ID[name]), uint('SeekPosition', pos))));
    return concat([head, voidOf(SEEK_AREA - head.length)]);
  }

  // --- blocks and clusters ------------------------------------------------------------------------------------------

  // Blocks are { track, ms, key, data, alpha, ref } (ref: the previous video frame's ms, for a delta frame). Pieces are
  // gathered as a list of byte arrays; frame data is referenced, not copied, until the cluster is assembled.
  function header(name, n) { return [ID[name], ebmlSize(n)]; }

  function blockHead(track, rel, flags) {
    return Uint8Array.of(0x80 | track, (rel >> 8) & 0xff, rel & 0xff, flags);
  }

  function blockPieces(b, rel, grouped) {
    if (!grouped) {
      const head = blockHead(b.track, rel, b.key ? KEY_FLAG : 0);
      return [...header('SimpleBlock', head.length + b.data.length), head, b.data];
    }
    const head = blockHead(b.track, rel, 0);
    const inner = [...header('Block', head.length + b.data.length), head, b.data];
    if (b.alpha) {
      const id = uint('BlockAddID', ALPHA_ADD_ID);
      const more = [id, ...header('BlockAdditional', b.alpha.length), b.alpha];
      const moreEl = [...header('BlockMore', size(more)), ...more];
      inner.push(...header('BlockAdditions', size(moreEl)), ...moreEl);
    }
    if (!b.key) inner.push(el('ReferenceBlock', intBytes(b.ref - b.ms)));
    return [...header('BlockGroup', size(inner)), ...inner];
  }

  function size(parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    return n;
  }

  // Merges a group's video frames and audio packets in time order (video first at equal times), then splits them into
  // clusters so that no block is more than MAX_RELATIVE ms after its cluster's Timestamp.
  function clustersOf(frames, packets) {
    const blocks = [];
    let i = 0, j = 0;
    while (i < frames.length || j < packets.length) {
      if (j >= packets.length || (i < frames.length && frames[i].ms <= packets[j].ms)) blocks.push(frames[i++]);
      else blocks.push(packets[j++]);
    }
    const out = [];
    for (const b of blocks) {
      const last = out[out.length - 1];
      if (last && b.ms - last.ms <= MAX_RELATIVE) last.blocks.push(b);
      else out.push({ ms: b.ms, blocks: [b] });
    }
    return out;
  }

  // --- the writer ---------------------------------------------------------------------------------------------------

  // createWebm({ write, w, h, fps, video: { codec: 'V_VP9' | 'V_VP8', alpha }, audio: { rate, channels, codecPrivate } | null })
  //   → { video(colour, alpha, key, ts), audio(chunk, ts), finish() }
  // Pure: every byte goes through write(bytes, position?), the export sink contract (§4.21): appends without a position,
  // then finish() patches the Segment size, the Duration and the SeekHead with positional writes. Writes are queued in
  // order; write may return a promise.
  //   video(colour, alpha, key, ts): one frame; ts in µs (the chunk timestamp, ts(i)), strictly increasing. `key` means
  //     decoding can start here: with alpha, pass true only when both the colour and the alpha frames are key frames.
  //     `alpha` is the alpha encoder's frame (BlockAdditional id 1), or null. Frames are copied.
  //   audio(chunk, ts): one Opus packet on track 2; ts in µs, strictly increasing.
  //   Both return a promise that resolves once the bytes they completed are written (it never rejects: a failed write
  //   makes the next call throw ExportError('sink'), and finish() reject).
  //   finish() → Promise<{ bytes, frames, packets, clusters, cues, duration (s) }>.
  // A cluster starts at every key frame, holds the audio up to the next key frame, and is written once it is complete
  // (for audio, once a packet at or after its end has arrived). The output depends only on each track's own sequence,
  // not on how the video() and audio() calls interleave. Without alpha, frames are SimpleBlocks; with alpha, BlockGroups.
  function createWebm(opts) {
    const o = checkOptions(opts);
    const write = o.write;
    let offset = 0;                      // bytes appended so far
    let chain = Promise.resolve();
    let failed = null;
    let finished = false;

    let group = null;                    // video frames since the last key frame
    const closed = [];                   // [{ frames, end }] groups whose next key frame has arrived, in order
    let queue = [];                      // audio packets not yet in a cluster
    let head = 0;                        // queue[head] is the oldest of them
    const cues = [];                     // [{ ms, pos }]
    let lastVideoMs = null;              // the previous frame's time
    let lastAudioUs = -1;
    let lastAudioMs = -Infinity;
    let endUs = 0;                       // the end of the last frame or packet (for Duration)
    let frames = 0, packets = 0, clusters = 0;

    function put(bytes, position) {
      if (position === undefined) offset += bytes.length;
      chain = chain.then(() => (failed ? undefined : write(bytes, position))).then(null, (err) => { failed = failed || err; });
      return chain;
    }

    function sinkFailure() { return new S.ExportError('sink', 'webm: writing the file failed: ' + (failed && failed.message), failed); }

    function check() {
      if (finished) throw new S.ExportError('finished', 'webm: write after finish');
      if (failed) throw sinkFailure();
    }

    const ebml = ebmlHeader();
    const segmentAt = ebml.length;
    const segStart = segmentAt + ID.Segment.length + 8;        // the Segment's data: positions inside it count from here
    const info = infoElement();
    const tracks = el('Tracks', videoEntry(o), ...(o.audio ? [audioEntry(o.audio)] : []));
    const infoPos = SEEK_AREA;
    const tracksPos = infoPos + info.bytes.length;
    const durationAt = segStart + infoPos + info.durationAt;
    put(concat([ebml, ID.Segment, Uint8Array.from(UNKNOWN_SIZE), seekArea([['Info', infoPos], ['Tracks', tracksPos]]),
      info.bytes, tracks]));

    // Appends the clusters of one group; each key frame gets a CuePoint at the cluster that holds it.
    function writeGroup(frameList, packetList) {
      for (const c of clustersOf(frameList, packetList)) {
        const pos = offset - segStart;
        const body = [uint('Timestamp', c.ms)];
        for (const b of c.blocks) {
          if (b.track === VIDEO_TRACK && b.key) cues.push({ ms: b.ms, pos });
          body.push(...blockPieces(b, b.ms - c.ms, b.track === VIDEO_TRACK && o.alpha));
        }
        put(concat([...header('Cluster', size(body)), ...body]));
        clusters++;
      }
    }

    // Audio packets before `end` (ms), taken from the queue.
    function takeAudio(end) {
      const out = [];
      while (head < queue.length && queue[head].ms < end) out.push(queue[head++]);
      if (head >= COMPACT_AFTER && head * 2 >= queue.length) { queue = queue.slice(head); head = 0; }
      return out;
    }

    // Writes every closed group whose audio is complete, or all of them (finish() closes the last with end = Infinity).
    function flush(all) {
      while (closed.length && (all || !o.audio || lastAudioMs >= closed[0].end)) {
        const g = closed.shift();
        writeGroup(g.frames, takeAudio(g.end));
      }
      return chain;
    }

    function video(colour, alpha, key, ts) {
      check();
      checkTime(ts, 'video');
      const ms = Math.round(ts / 1000);
      if (lastVideoMs !== null && ms <= lastVideoMs) throw new S.ExportError('order', 'webm: video times must increase (in whole ms)');
      if (lastVideoMs === null && !key) throw new S.ExportError('order', 'webm: the first video frame must be a key frame');
      const hasAlpha = alpha !== null && alpha !== undefined;
      if (hasAlpha && !o.alpha) throw argsError('an alpha frame on a track without alpha');
      const frame = { track: VIDEO_TRACK, ms, key: !!key, data: bytesOf(colour, 'video frame'),
        alpha: hasAlpha ? bytesOf(alpha, 'alpha frame') : null, ref: lastVideoMs };
      endUs = Math.max(endUs, ts + (chunkDuration(colour) || 1e6 / o.fps));
      lastVideoMs = ms;
      frames++;
      if (frame.key && group) closed.push({ frames: group.frames, end: ms });
      if (frame.key || !group) group = { frames: [frame] };
      else group.frames.push(frame);
      return flush(false);
    }

    function audio(chunk, ts) {
      check();
      if (!o.audio) throw argsError('audio on a file without an audio track');
      checkTime(ts, 'audio');
      if (ts <= lastAudioUs) throw new S.ExportError('order', 'webm: audio timestamps must increase');
      const ms = Math.round(ts / 1000);
      queue.push({ track: AUDIO_TRACK, ms, key: true, data: bytesOf(chunk, 'audio packet'), alpha: null, ref: null });
      endUs = Math.max(endUs, ts + (chunkDuration(chunk) || 0));
      lastAudioUs = ts;
      lastAudioMs = ms;
      packets++;
      return flush(false);
    }

    async function finish() {
      check();
      finished = true;
      if (group) { closed.push({ frames: group.frames, end: Infinity }); group = null; }
      flush(true);
      if (head < queue.length) writeGroup([], takeAudio(Infinity));      // audio without any video frame
      const seeks = [['Info', infoPos], ['Tracks', tracksPos]];
      if (cues.length) {
        seeks.push(['Cues', offset - segStart]);
        put(el('Cues', ...cues.map((c) => el('CuePoint', uint('CueTime', c.ms),
          el('CueTrackPositions', uint('CueTrack', VIDEO_TRACK), uint('CueClusterPosition', c.pos))))));
      }
      const endMicros = Math.round(endUs);
      put(ebmlSize(offset - segStart, 8), segmentAt + ID.Segment.length);
      put(f64(endMicros / 1000), durationAt);                     // Duration counts ticks (ms)
      put(seekArea(seeks), segStart);
      await chain;
      if (failed) throw sinkFailure();
      return { bytes: offset, frames, packets, clusters, cues: cues.length, duration: endMicros / 1e6 };
    }

    return { video, audio, finish };
  }

  return { IDS, createWebm, ebmlSize, ebmlId };
});
