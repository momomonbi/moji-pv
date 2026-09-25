/* 文字PVメーカー v2 — original work. WebM / Matroska demuxer: element headers, block headers and sample tables only (DESIGN_2_1 §11.3.4, §11.4.3). */
MV.def('media/matroska', ['media/samples'], (SM) => {
  'use strict';

  // parse(read, size, { onProgress, tracksOnly }) → Promise<Movie> (the shape of media/isobmff; Track.alpha is AlphaMode
  // 1, and the table carries aoff/asize, the BlockAdditional id 1 ranges of WebM alpha). With tracksOnly the scan stops
  // after the Tracks element: the tracks come back without tables (routing: does the file have a video track?).
  // The file is scanned once, front to back, in windows of 4 MB: only element and block headers are parsed; frame data
  // inside a window is skipped (but read with it); a frame larger than a window is skipped without reading. Cues are
  // not needed: the sample table is complete. Laced video blocks are refused (MediaError('container')).

  const WINDOW = 4 * 1024 * 1024;
  const ID = Object.freeze({
    EBML: 0x1a45dfa3, DocType: 0x4282, Segment: 0x18538067,
    SeekHead: 0x114d9b74, Info: 0x1549a966, Tracks: 0x1654ae6b, Cues: 0x1c53bb6b, Cluster: 0x1f43b675,
    Chapters: 0x1043a770, Tags: 0x1254c367, Attachments: 0x1941a469, Void: 0xec, CRC32: 0xbf,
    TimestampScale: 0x2ad7b1, Duration: 0x4489,
    TrackEntry: 0xae, TrackNumber: 0xd7, TrackType: 0x83, CodecID: 0x86, CodecPrivate: 0x63a2, DefaultDuration: 0x23e383,
    ContentEncodings: 0x6d80, Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba, AlphaMode: 0x53c0, Colour: 0x55b0,
    MatrixCoefficients: 0x55b1, Range: 0x55b9, TransferCharacteristics: 0x55ba, Primaries: 0x55bb,
    Timestamp: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, BlockAdditions: 0x75a1, BlockMore: 0xa6,
    BlockAddID: 0xee, BlockAdditional: 0xa5, ReferenceBlock: 0xfb, BlockDuration: 0x9b,
  });
  const TOP = new Set([ID.SeekHead, ID.Info, ID.Tracks, ID.Cues, ID.Cluster, ID.Chapters, ID.Tags, ID.Attachments]);
  const CODECS = { V_VP8: 'vp08', V_VP9: 'vp09', V_AV1: 'av01', 'V_MPEG4/ISO/AVC': 'avc1', 'V_MPEGH/ISO/HEVC': 'hvc1' };

  const broken = (msg) => new SM.MediaError('broken', 'webm: ' + msg);

  // A sequential window over the file: bytes(at, n) keeps the current 4 MB window while the range is inside it, and
  // otherwise reads a new window starting at `at`. `read` counts every byte the parser pulls.
  function scanner(read, size) {
    let winAt = 0, win = new Uint8Array(0);
    return {
      size,
      async bytes(at, n) {
        if (at < 0 || at + n > size) throw broken('the file ends early (at ' + at + ')');
        if (at >= winAt && at + n <= winAt + win.length) return win.subarray(at - winAt, at - winAt + n);
        const len = Math.min(size - at, Math.max(n, WINDOW));
        const got = await read(at, len);
        if (!got || got.length < n) throw broken('the file ends early (at ' + at + ')');
        winAt = at;
        win = got;
        return win.subarray(0, n);
      },
    };
  }

  // Variable-length integers (RFC 8794): an element id keeps its marker bits; a size drops them (all ones = unknown).
  function vintLength(first) {
    for (let k = 0; k < 8; k++) if (first & (0x80 >> k)) return k + 1;
    return 0;
  }

  // header(sc, at) → { id, size (null = unknown), body (offset of the data) }
  async function header(sc, at) {
    const head = await sc.bytes(at, Math.min(12, sc.size - at));
    const il = vintLength(head[0]);
    if (!il || il > 4 || il >= head.length) throw broken('bad element id at ' + at);
    let id = 0;
    for (let k = 0; k < il; k++) id = id * 256 + head[k];
    const sl = vintLength(head[il]);
    if (!sl || il + sl > head.length) throw broken('bad element size at ' + at);
    let value = head[il] & (0xff >> sl);
    let allOnes = value === (0xff >> sl);
    for (let k = 1; k < sl; k++) { value = value * 256 + head[il + k]; if (head[il + k] !== 0xff) allOnes = false; }
    return { id, size: allOnes ? null : value, body: at + il + sl };
  }

  function uint(b) { let v = 0; for (let k = 0; k < b.length; k++) v = v * 256 + b[k]; return v; }
  function float(b) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return b.length === 4 ? v.getFloat32(0) : b.length === 8 ? v.getFloat64(0) : 0;
  }
  function text(b) { let s = ''; for (let k = 0; k < b.length && b[k]; k++) s += String.fromCharCode(b[k]); return s; }

  // Children of an in-memory master element (Info, Tracks): [{ id, data }]
  function childrenOf(b) {
    const out = [];
    for (let p = 0; p < b.length;) {
      const il = vintLength(b[p]);
      if (!il || il > 4 || p + il >= b.length) break;
      let id = 0;
      for (let k = 0; k < il; k++) id = id * 256 + b[p + k];
      const sl = vintLength(b[p + il]);
      if (!sl || p + il + sl > b.length) break;
      let size = b[p + il] & (0xff >> sl);
      for (let k = 1; k < sl; k++) size = size * 256 + b[p + il + k];
      const body = p + il + sl;
      if (body + size > b.length) break;
      out.push({ id, data: b.subarray(body, body + size) });
      p = body + size;
    }
    return out;
  }

  function readTrack(entry) {
    const t = { number: 0, type: 0, codecId: '', priv: null, defaultDuration: 0, w: 0, h: 0, alphaMode: 0, color: null, encoded: false };
    for (const c of childrenOf(entry)) {
      if (c.id === ID.TrackNumber) t.number = uint(c.data);
      else if (c.id === ID.TrackType) t.type = uint(c.data);
      else if (c.id === ID.CodecID) t.codecId = text(c.data);
      else if (c.id === ID.CodecPrivate) t.priv = c.data.slice();
      else if (c.id === ID.DefaultDuration) t.defaultDuration = uint(c.data);
      else if (c.id === ID.ContentEncodings) t.encoded = true;
      else if (c.id === ID.Video) {
        for (const v of childrenOf(c.data)) {
          if (v.id === ID.PixelWidth) t.w = uint(v.data);
          else if (v.id === ID.PixelHeight) t.h = uint(v.data);
          else if (v.id === ID.AlphaMode) t.alphaMode = uint(v.data);
          else if (v.id === ID.Colour) t.color = readColour(v.data);
        }
      }
    }
    return t;
  }

  function readColour(b) {
    const color = { primaries: 2, transfer: 2, matrix: 2, fullRange: null };
    for (const c of childrenOf(b)) {
      if (c.id === ID.MatrixCoefficients) color.matrix = uint(c.data);
      else if (c.id === ID.TransferCharacteristics) color.transfer = uint(c.data);
      else if (c.id === ID.Primaries) color.primaries = uint(c.data);
      else if (c.id === ID.Range) { const r = uint(c.data); color.fullRange = r === 2 ? true : r === 1 ? false : null; }
    }
    return color;
  }

  // The VP9 uncompressed header of a key frame: profile and bit depth (VP9 bitstream §6.2).
  function vp9Header(b) {
    let bit = 0;
    const read = (n) => { let v = 0; for (let k = 0; k < n; k++, bit++) v = (v << 1) | ((b[bit >> 3] >> (7 - (bit & 7))) & 1); return v; };
    if (b.length < 4 || read(2) !== 2) return null;
    const low = read(1), high = read(1);
    const profile = (high << 1) | low;
    if (profile === 3) read(1);
    if (read(1)) return null;                       // show_existing_frame
    if (read(1) !== 0) return null;                 // frame_type: 0 = key frame
    read(2);                                        // show_frame, error_resilient_mode
    if (read(8) !== 0x49 || read(8) !== 0x83 || read(8) !== 0x42) return null;
    const depth = profile >= 2 ? (read(1) ? 12 : 10) : 8;
    return { profile, depth };
  }

  // --- the scan ---------------------------------------------------------------------------------------------------------

  async function parse(read, size, opts) {
    if (typeof read !== 'function' || !(size > 0)) throw broken('nothing to read');
    const onProgress = opts && typeof opts.onProgress === 'function' ? opts.onProgress : null;
    const tracksOnly = !!(opts && opts.tracksOnly);
    const sc = scanner(read, size);
    const ebml = await header(sc, 0);
    if (ebml.id !== ID.EBML || ebml.size === null) throw broken('no EBML header');
    let doc = '';
    for (const c of childrenOf(await sc.bytes(ebml.body, ebml.size))) if (c.id === ID.DocType) doc = text(c.data);
    if (doc !== 'webm' && doc !== 'matroska') throw broken('DocType ' + JSON.stringify(doc));
    const seg = await header(sc, ebml.body + ebml.size);
    if (seg.id !== ID.Segment) throw broken('no Segment');
    if (seg.size !== null && seg.body + seg.size > size) throw broken('the file is shorter than its Segment');
    const segEnd = seg.size === null ? size : seg.body + seg.size;
    const state = { doc, scale: 1000000, duration: 0, tracks: null, byNumber: new Map(), warnings: [] };
    let p = seg.body;
    let lastProgress = 0;
    while (p < segEnd) {
      if (segEnd - p < 2) break;
      const el = await header(sc, p);
      if (el.id === ID.Cluster) {
        if (!state.tracks) throw broken('a Cluster comes before Tracks');
        p = await cluster(sc, el, segEnd, state);
      } else {
        if (el.size === null) throw broken('unknown size outside Segment and Cluster');
        const end = el.body + el.size;
        if (end > segEnd) throw broken('an element runs past the end (at ' + p + ')');
        if (el.id === ID.Info) readInfo(await sc.bytes(el.body, el.size), state);
        else if (el.id === ID.Tracks) {
          readTracks(await sc.bytes(el.body, el.size), state);
          if (tracksOnly) return headerOnly(state);
        }
        p = end;
      }
      if (onProgress && p - lastProgress >= WINDOW) { lastProgress = p; onProgress(Math.min(1, p / size)); }
    }
    if (!state.tracks) throw broken('no Tracks');
    if (onProgress) onProgress(1);
    return finish(state);
  }

  function readInfo(b, state) {
    for (const c of childrenOf(b)) {
      if (c.id === ID.TimestampScale) state.scale = uint(c.data) || 1000000;
      else if (c.id === ID.Duration) state.duration = float(c.data);
    }
  }

  function readTracks(b, state) {
    state.tracks = [];
    for (const c of childrenOf(b)) {
      if (c.id !== ID.TrackEntry) continue;
      const t = readTrack(c.data);
      t.acc = t.type === 1 ? { cts: [], dur: [], key: [], off: [], size: [], aoff: [], asize: [], hasAlpha: false, first: null } : null;
      state.tracks.push(t);
      state.byNumber.set(t.number, t);
    }
  }

  // Scans one Cluster (known or unknown size) and returns the offset after it.
  async function cluster(sc, el, segEnd, state) {
    const end = el.size === null ? segEnd : el.body + el.size;
    if (end > segEnd) throw broken('a Cluster runs past the end (at ' + el.body + ')');
    let time = 0;
    let p = el.body;
    while (p < end) {
      if (end - p < 2) break;
      const c = await header(sc, p);
      if (el.size === null && (TOP.has(c.id) || c.id === ID.Segment)) return p;   // an unknown-size cluster ends here
      if (c.size === null) throw broken('unknown size inside a Cluster');
      const cEnd = c.body + c.size;
      if (cEnd > end) throw broken('a block runs past its Cluster (at ' + p + ')');
      if (c.id === ID.Timestamp) time = uint(await sc.bytes(c.body, c.size));
      else if (c.id === ID.SimpleBlock) await simpleBlock(sc, c.body, c.size, time, state);
      else if (c.id === ID.BlockGroup) await blockGroup(sc, c, time, state);
      p = cEnd;
    }
    return end;
  }

  // A BlockGroup: its Block header is read when it is met (the scan never goes back), and recorded after the group's
  // other children (ReferenceBlock, BlockDuration, BlockAdditions) are known.
  async function blockGroup(sc, g, time, state) {
    const info = { key: true, head: null, aoff: -1, asize: 0, duration: null };
    for (let p = g.body, end = g.body + g.size; p < end;) {
      const c = await header(sc, p);
      if (c.size === null || c.body + c.size > end) throw broken('bad BlockGroup');
      if (c.id === ID.Block) info.head = await blockHead(sc, c.body, c.size, state);
      else if (c.id === ID.ReferenceBlock) info.key = false;
      else if (c.id === ID.BlockDuration) info.duration = uint(await sc.bytes(c.body, c.size));
      else if (c.id === ID.BlockAdditions) await additions(sc, c, info);
      p = c.body + c.size;
    }
    if (info.head) record(info.head, time, info);
  }

  // BlockAdditions/BlockMore(BlockAddID 1, the default)/BlockAdditional: the alpha frame's byte range.
  async function additions(sc, el, info) {
    for (let p = el.body, end = el.body + el.size; p < end;) {
      const more = await header(sc, p);
      if (more.size === null || more.body + more.size > end) throw broken('bad BlockAdditions');
      if (more.id === ID.BlockMore) {
        let addId = 1, at = -1, len = 0;
        for (let q = more.body, qEnd = more.body + more.size; q < qEnd;) {
          const c = await header(sc, q);
          if (c.size === null || c.body + c.size > qEnd) throw broken('bad BlockMore');
          if (c.id === ID.BlockAddID) addId = uint(await sc.bytes(c.body, c.size));
          else if (c.id === ID.BlockAdditional) { at = c.body; len = c.size; }
          q = c.body + c.size;
        }
        if (addId === 1 && at >= 0) { info.aoff = at; info.asize = len; }
      }
      p = more.body + more.size;
    }
  }

  // The header of a (Simple)Block: track number, relative timestamp, flags → { t, rel, flags, dataAt, dataSize, first }
  // for a video track (first: the frame's first 16 bytes while the track's first key frame is still unknown), or null
  // for audio and other tracks, which are skipped (laced or not).
  async function blockHead(sc, at, size, state) {
    const head = await sc.bytes(at, Math.min(size, 12));
    const tl = vintLength(head[0]);
    if (!tl || tl > 8 || tl + 3 > head.length) throw broken('bad block header at ' + at);
    let track = head[0] & (0xff >> tl);
    for (let k = 1; k < tl; k++) track = track * 256 + head[k];
    const rel = (head[tl] << 24 >> 16) | head[tl + 1];            // int16
    const flags = head[tl + 2];
    const t = state.byNumber.get(track);
    if (!t || !t.acc) return null;
    if (flags & 0x06) throw new SM.MediaError('container', 'webm: laced video blocks are not supported');
    const dataAt = at + tl + 3, dataSize = size - tl - 3;
    const first = !t.acc.first && dataSize >= 4 ? (await sc.bytes(dataAt, Math.min(dataSize, 16))).slice() : null;
    return { t, rel, flags, dataAt, dataSize, first };
  }

  async function simpleBlock(sc, at, size, time, state) {
    const h = await blockHead(sc, at, size, state);
    if (h) record(h, time, null);
  }

  // Records one video frame (decode order) with its key flag, duration and alpha range.
  function record(h, clusterTime, group) {
    const a = h.t.acc;
    const key = group ? group.key : !!(h.flags & 0x80);
    a.cts.push(clusterTime + h.rel);
    a.dur.push(group && group.duration !== null ? group.duration : 0);
    a.key.push(key ? 1 : 0);
    a.off.push(h.dataAt);
    a.size.push(h.dataSize);
    a.aoff.push(group && group.aoff >= 0 ? group.aoff : 0);
    a.asize.push(group && group.aoff >= 0 ? group.asize : 0);
    if (group && group.aoff >= 0) a.hasAlpha = true;
    if (!a.first && key && h.first) a.first = h.first;
  }

  function headerOnly(state) {
    const kinds = { 1: 'video', 2: 'audio' };
    return { brand: state.doc, duration: state.duration * (state.scale / 1e9), warnings: state.warnings,
      tracks: state.tracks.map((t) => ({ id: t.number, kind: kinds[t.type] || 'other', codec: CODECS[t.codecId] || t.codecId, table: null })) };
  }

  // WebM stores whole milliseconds, so at 24, 30 or 60 fps a third of the frames start up to 0.5 ms after k / fps, and
  // sampleAt(k / fps) (EPS 0.1 ms) would pick frame k − 1. Lead decision: when the track has a DefaultDuration and
  // every block time is within 0.5 ms of i · DefaultDuration (i = the presentation index, counted from the first
  // frame), the frames start exactly there. → decode-order times in ns, or null (variable rate: the stored times stay).
  const SNAP_NS = 500000;
  function snapToDefault(cts, scale, defaultNs) {
    if (!(defaultNs > 0) || !cts.length) return null;
    const order = cts.map((c, d) => d).sort((x, y) => cts[x] - cts[y] || x - y);
    const first = cts[order[0]] * scale;
    const out = new Array(cts.length);
    for (let i = 0; i < order.length; i++) {
      const ns = cts[order[i]] * scale - first;
      if (Math.abs(ns - i * defaultNs) > SNAP_NS) return null;
      out[order[i]] = i * defaultNs;
    }
    return out;
  }

  function finish(state) {
    const tracks = [];
    const tickSeconds = state.scale / 1e9;
    for (const t of state.tracks) {
      const kind = t.type === 1 ? 'video' : t.type === 2 ? 'audio' : 'other';
      const fourcc = CODECS[t.codecId] || t.codecId;
      const track = { id: t.number, kind, codec: fourcc, fourcc, description: null, codedW: t.w, codedH: t.h, w: t.w, h: t.h,
        rot: 0, timescale: 1 / tickSeconds, color: t.color, table: null, alpha: false };
      tracks.push(track);
      if (kind !== 'video') continue;
      if (t.encoded) throw new SM.MediaError('container', 'webm: content encodings (compression, encryption) are not supported');
      const a = t.acc;
      if (!a.cts.length) throw broken('track ' + t.number + ' has no frames');
      const defaultTicks = t.defaultDuration ? t.defaultDuration / state.scale : 0;
      for (let k = 0; k < a.dur.length; k++) if (!a.dur[k]) a.dur[k] = defaultTicks;
      track.alpha = t.alphaMode === 1;
      const snapped = snapToDefault(a.cts, state.scale, t.defaultDuration);
      track.table = SM.build({ timescale: snapped ? 1e9 : 1 / tickSeconds, cts: snapped || a.cts,
        dur: snapped ? a.dur.map((d) => d * state.scale) : a.dur, key: a.key, off: a.off, size: a.size,
        aoff: a.hasAlpha ? a.aoff : null, asize: a.hasAlpha ? a.asize : null });
      if (fourcc === 'vp09') {
        const vp9 = a.first ? vp9Header(a.first) : null;
        track.codec = SM.codecString({ fourcc, profile: vp9 ? vp9.profile : 0, depth: vp9 ? vp9.depth : 8,
          level: SM.vp9Level(t.w, t.h, track.table.fps) });
      } else {
        track.codec = SM.codecString({ fourcc, config: t.priv });
        if (fourcc === 'av01' || fourcc === 'avc1' || fourcc === 'hvc1') track.description = t.priv && t.priv.length ? t.priv : null;
      }
    }
    return { brand: state.doc, duration: state.duration * tickSeconds, tracks, warnings: state.warnings };
  }

  return { parse, ID, WINDOW, vp9Header };
});
