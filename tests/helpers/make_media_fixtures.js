/* 文字PVメーカー v2 — original work. Writes the committed demuxer fixtures of DESIGN_2_1 §11.8.1 byte by byte (tests/fixtures/media/). */
// There is no ffmpeg where these fixtures were made, so this generator writes the container structures itself: every
// box and element a demuxer reads is real, and the codec payloads are placeholder bytes (the demuxers never decode
// them; only the first bytes of a VP9 key frame, its uncompressed header, are real). The same run writes MAKE.txt: the
// ffmpeg recipe that could replace each file later, and the table the demuxer must return, computed here from what was
// written (not from the demuxer). tests/node/media_demux.test.js rebuilds everything in memory and checks that the
// committed files are unchanged, then checks the demuxers against MAKE.txt.
// Run: node tests/helpers/make_media_fixtures.js --write
'use strict';

const W = 64, H = 36, FPS = 25, FRAMES = 25;

// --- bytes ------------------------------------------------------------------------------------------------------------

function concat(parts) {
  const flat = [];
  for (const p of parts) {
    if (p === null || p === undefined) continue;
    if (p instanceof Uint8Array || Array.isArray(p)) flat.push(p instanceof Uint8Array ? p : Uint8Array.from(p));
    else if (typeof p === 'string') flat.push(Uint8Array.from(Buffer.from(p, 'latin1')));
    else throw new TypeError('concat: ' + typeof p);
  }
  const out = new Uint8Array(flat.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of flat) { out.set(p, at); at += p.length; }
  return out;
}

const u8 = (v) => [v & 255];
const u16 = (v) => [(v >>> 8) & 255, v & 255];
const u24 = (v) => [(v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const i32 = (v) => u32(v >>> 0);
const u64 = (v) => [...u32(Math.floor(v / 0x100000000)), ...u32(v >>> 0)];
const zeros = (n) => new Array(n).fill(0);
const fixed16 = (v) => i32(Math.round(v * 65536));

// A deterministic placeholder payload: a tag, the frame number, then a pattern.
function payload(tag, i, size) {
  const out = new Uint8Array(size);
  for (let k = 0; k < size; k++) out[k] = (i * 31 + k * 7 + tag.charCodeAt(0)) & 255;
  for (let k = 0; k < tag.length && k < size; k++) out[k] = tag.charCodeAt(k);
  if (size > tag.length) out[tag.length] = i & 255;
  return out;
}

const sizeOf = (i) => 48 + ((i * 37) % 29);

// --- ISO BMFF ---------------------------------------------------------------------------------------------------------

function box(type, ...parts) {
  const body = concat(parts);
  return concat([u32(8 + body.length), type, body]);
}

function full(type, version, flags, ...parts) { return box(type, u8(version), u24(flags), ...parts); }

const MATRIX = {
  0: [1, 0, 0, 1],
  90: [0, 1, -1, 0],
};

function tkhd(id, durationMovie, rot, w, h, audio) {
  const [a, b, c, d] = MATRIX[rot];
  return full('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(durationMovie), zeros(8), u16(0), u16(0),
    u16(audio ? 0x0100 : 0), u16(0), fixed16(a), fixed16(b), u32(0), fixed16(c), fixed16(d), u32(0), u32(0), u32(0),
    u32(0x40000000), fixed16(audio ? 0 : w), fixed16(audio ? 0 : h));
}

function mvhd(timescale, duration, nextId) {
  return full('mvhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u32(0x00010000), u16(0x0100), zeros(10),
    fixed16(1), u32(0), u32(0), u32(0), fixed16(1), u32(0), u32(0), u32(0), u32(0x40000000), zeros(24), u32(nextId));
}

function mdhd(timescale, duration) { return full('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0)); }

function hdlr(handler, qt) { return full('hdlr', 0, 0, qt ? 'mhlr' : u32(0), handler, zeros(12), qt ? [0] : 'VideoHandler\0'); }

// A VisualSampleEntry (ISO/IEC 14496-12 §12.1.3) with its child boxes.
function visualEntry(fourcc, w, h, ...kids) {
  return box(fourcc, zeros(6), u16(1), zeros(16), u16(w), u16(h), u32(0x00480000), u32(0x00480000), u32(0), u16(1),
    zeros(32), u16(24), u16(0xffff), ...kids);
}

function soundEntry(fourcc) { return box(fourcc, zeros(6), u16(1), zeros(8), u16(2), u16(16), u16(0), u16(0), u32(48000 * 65536)); }

// avcC with one placeholder SPS and PPS (the demuxer reads the profile, constraint and level bytes only).
function avcC(profile, compat, level) {
  const sps = [0x67, profile, compat, level, 0xac, 0xd9, 0x41, 0x41, 0xfb, 0x01, 0x10];
  const pps = [0x68, 0xeb, 0xe3, 0xcb, 0x22, 0xc0];
  return [1, profile, compat, level, 0xff, 0xe1, ...u16(sps.length), ...sps, 1, ...u16(pps.length), ...pps];
}

// stbl tables from decode-order samples { size, dur, cto, key }, in chunks of `per` samples starting at `offsets[c]`.
function stbl(entry, samples, offsets, per, opts) {
  const o = opts || {};
  const stts = [];
  for (const s of samples) {
    const last = stts[stts.length - 1];
    if (last && last[1] === s.dur) last[0]++; else stts.push([1, s.dur]);
  }
  const kids = [full('stsd', 0, 0, u32(1), entry), full('stts', 0, 0, u32(stts.length), ...stts.map(([c, d]) => [...u32(c), ...u32(d)]))];
  if (samples.some((s) => s.cto)) {
    const runs = [];
    for (const s of samples) {
      const last = runs[runs.length - 1];
      if (last && last[1] === s.cto) last[0]++; else runs.push([1, s.cto]);
    }
    kids.push(full('ctts', o.cttsVersion || 0, 0, u32(runs.length), ...runs.map(([c, v]) => [...u32(c), ...i32(v)])));
  }
  if (!samples.every((s) => s.key)) {
    const keys = samples.map((s, d) => (s.key ? d + 1 : 0)).filter(Boolean);
    kids.push(full('stss', 0, 0, u32(keys.length), ...keys.map(u32)));
  }
  kids.push(full('stsc', 0, 0, u32(1), u32(1), u32(per), u32(1)));
  if (o.fixedSize) kids.push(full('stsz', 0, 0, u32(o.fixedSize), u32(samples.length)));
  else kids.push(full('stsz', 0, 0, u32(0), u32(samples.length), ...samples.map((s) => u32(s.size))));
  if (o.co64) kids.push(full('co64', 0, 0, u32(offsets.length), ...offsets.map(u64)));
  else kids.push(full('stco', 0, 0, u32(offsets.length), ...offsets.map(u32)));
  return box('stbl', ...kids);
}

// trak for a track description: { id, handler, timescale, samples, entry, rot, edits, per, qt, opts, audio }
function trak(t, offsets, movieDuration) {
  const mediaDuration = t.samples.reduce((n, s) => n + s.dur, 0);
  const edts = t.edits ? box('edts', full('elst', 0, 0, u32(t.edits.length), ...t.edits.map(([d, m]) => [...u32(d), ...i32(m), ...u32(0x00010000)]))) : null;
  const minf = box('minf', t.audio ? full('smhd', 0, 0, u32(0)) : full('vmhd', 0, 1, zeros(8)),
    box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))), stbl(t.entry, t.samples, offsets, t.per, t.opts));
  return box('trak', tkhd(t.id, movieDuration, t.rot || 0, W, H, t.audio), edts,
    box('mdia', mdhd(t.timescale, mediaDuration), hdlr(t.audio ? 'soun' : 'vide', t.qt), minf));
}

// A whole movie: { ftyp, tracks, fast (moov first), pre: [boxes before mdat], movieScale, movieDuration }
// Each track's payloads are written chunk by chunk, the tracks' chunks interleaved; returns { bytes, offsets } where
// offsets[t][d] is the file offset of track t's decode-order sample d.
function movie(m) {
  const payloads = m.tracks.map((t) => t.samples.map((s, d) => s.data || payload(t.tag, d, s.size)));
  const layout = (mdatAt) => {
    let at = mdatAt + 8;
    const chunkOffsets = m.tracks.map(() => []);
    const sampleOffsets = m.tracks.map(() => []);
    const order = [];
    const maxChunks = Math.max(...m.tracks.map((t) => Math.ceil(t.samples.length / t.per)));
    for (let c = 0; c < maxChunks; c++) {
      m.tracks.forEach((t, k) => {
        const from = c * t.per;
        if (from >= t.samples.length) return;
        chunkOffsets[k].push(at);
        for (let d = from; d < Math.min(t.samples.length, from + t.per); d++) {
          sampleOffsets[k][d] = at;
          order.push(payloads[k][d]);
          at += payloads[k][d].length;
        }
      });
    }
    return { chunkOffsets, sampleOffsets, mdat: concat([u32(8 + order.reduce((n, p) => n + p.length, 0)), 'mdat', ...order]) };
  };
  const moovOf = (chunkOffsets) => box('moov', mvhd(m.movieScale, m.movieDuration, m.tracks.length + 1),
    ...m.tracks.map((t, k) => trak(t, chunkOffsets[k], m.movieDuration)));
  const head = concat([m.ftyp, ...(m.pre || [])]);
  let mdatAt = head.length;
  if (m.fast) mdatAt += moovOf(m.tracks.map((t) => new Array(Math.ceil(t.samples.length / t.per)).fill(0))).length;
  const L = layout(mdatAt);
  const moov = moovOf(L.chunkOffsets);
  const bytes = m.fast ? concat([head, moov, L.mdat]) : concat([head, L.mdat, moov]);
  return { bytes, offsets: L.sampleOffsets };
}

// Decode order of a GOP of `len` frames with two B-frames between references: I0 P3 B1 B2 P6 B4 B5 P9 B7 B8 …
function gopOrder(len) {
  const out = [0];
  let ref = 0;
  while (ref < len - 1) {
    const next = Math.min(ref + 3, len - 1);
    out.push(next);
    for (let b = ref + 1; b < next; b++) out.push(b);
    ref = next;
  }
  return out;
}

// Presentation index per decode index for `frames` frames in GOPs of `gop`, and the decode indices of key frames.
function bOrder(frames, gop) {
  const order = [];
  for (let g = 0; g < frames; g += gop) for (const p of gopOrder(Math.min(gop, frames - g))) order.push(g + p);
  return order;
}

// --- EBML (Matroska / WebM) ---------------------------------------------------------------------------------------------

function idBytes(id) {
  const out = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 255);
  return out;
}

function sizeBytes(n) {
  for (let len = 1; len <= 8; len++) {
    if (n < 2 ** (7 * len) - 1) {
      const out = [];
      let v = n;
      for (let k = 0; k < len; k++) { out.unshift(v % 256); v = Math.floor(v / 256); }
      out[0] |= 0x80 >> (len - 1);
      return out;
    }
  }
  throw new RangeError('ebml size');
}

const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
function el(id, ...parts) { const body = concat(parts); return concat([idBytes(id), sizeBytes(body.length), body]); }
function elUnknown(id, ...parts) { return concat([idBytes(id), UNKNOWN, ...parts]); }
function uintBytes(v) { const out = []; do { out.unshift(v % 256); v = Math.floor(v / 256); } while (v > 0); return out; }
const eu = (id, v) => el(id, uintBytes(v));
const es = (id, s) => el(id, s);
const ef64 = (id, v) => { const b = Buffer.alloc(8); b.writeDoubleBE(v); return el(id, Uint8Array.from(b)); };

const E = {
  EBML: 0x1a45dfa3, EBMLVersion: 0x4286, EBMLReadVersion: 0x42f7, MaxIDLength: 0x42f2, MaxSizeLength: 0x42f3,
  DocType: 0x4282, DocTypeVersion: 0x4287, DocTypeReadVersion: 0x4285, Segment: 0x18538067, Void: 0xec,
  Info: 0x1549a966, TimestampScale: 0x2ad7b1, Duration: 0x4489, MuxingApp: 0x4d80, WritingApp: 0x5741,
  Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackUID: 0x73c5, TrackType: 0x83, FlagLacing: 0x9c,
  CodecID: 0x86, CodecPrivate: 0x63a2, DefaultDuration: 0x23e383, MaxBlockAdditionID: 0x55ee, Video: 0xe0,
  PixelWidth: 0xb0, PixelHeight: 0xba, AlphaMode: 0x53c0, Colour: 0x55b0, MatrixCoefficients: 0x55b1, Range: 0x55b9,
  TransferCharacteristics: 0x55ba, Primaries: 0x55bb, Audio: 0xe1, SamplingFrequency: 0xb5, Channels: 0x9f,
  Cluster: 0x1f43b675, Timestamp: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, BlockAdditions: 0x75a1,
  BlockMore: 0xa6, BlockAddID: 0xee, BlockAdditional: 0xa5, ReferenceBlock: 0xfb, BlockDuration: 0x9b,
  Cues: 0x1c53bb6b, CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7, CueTrack: 0xf7, CueClusterPosition: 0xf1,
};

function ebmlHeader(doc) {
  return el(E.EBML, eu(E.EBMLVersion, 1), eu(E.EBMLReadVersion, 1), eu(E.MaxIDLength, 4), eu(E.MaxSizeLength, 8),
    es(E.DocType, doc), eu(E.DocTypeVersion, 4), eu(E.DocTypeReadVersion, 2));
}

// A block header: track number (vint), int16 time relative to the cluster, flags.
function blockHead(track, rel, flags) { return [0x80 | track, (rel >> 8) & 255, rel & 255, flags]; }

// Frames of one video track: [{ time (ms), key, data, alpha?, group?, duration? }] into clusters that start at key
// frames. Returns { clusters: [{ at (offset in the segment body), time, bytes }], offsets: [data offset relative to
// the cluster start], alphaOffsets }. `extra(c)` adds more blocks (audio) to cluster c.
function clusters(frames, opts) {
  const o = opts || {};
  const groups = [];
  for (const f of frames) {
    if (f.key || !groups.length) groups.push({ time: f.time, frames: [] });
    groups[groups.length - 1].frames.push(f);
  }
  return groups.map((g, c) => {
    const parts = [el(E.Timestamp, uintBytes(g.time))];
    const marks = [];          // [frame, offset of its data inside this cluster's body, alpha offset]
    const pushBlock = (bytes, frame, dataAt, alphaAt) => {
      marks.push({ frame, dataAt: dataAt === null ? null : parts.reduce((n, p) => n + p.length, 0) + dataAt,
        alphaAt: alphaAt === null ? null : parts.reduce((n, p) => n + p.length, 0) + alphaAt });
      parts.push(bytes);
    };
    for (const [k, f] of g.frames.entries()) {
      const rel = f.time - g.time;
      if (!f.group) {
        const head = blockHead(1, rel, f.key ? 0x80 : 0);
        const block = el(E.SimpleBlock, head, f.data);
        pushBlock(block, f, block.length - f.data.length, null);
      } else {
        const inner = [];
        const blockEl = el(E.Block, blockHead(1, rel, 0), f.data);
        inner.push(blockEl);
        const dataInGroup = blockEl.length - f.data.length;
        let alphaInGroup = null;
        if (f.alpha) {
          const additional = el(E.BlockAdditional, f.alpha);
          const more = el(E.BlockMore, eu(E.BlockAddID, 1), additional);
          const adds = el(E.BlockAdditions, more);
          alphaInGroup = blockEl.length + (adds.length - more.length) + (more.length - additional.length) + (additional.length - f.alpha.length);
          inner.push(adds);
        }
        if (!f.key) inner.push(el(E.ReferenceBlock, [0xff, 0xd8]));       // -40: the previous frame
        if (f.duration) inner.push(eu(E.BlockDuration, f.duration));
        const body = concat(inner);
        const group = el(E.BlockGroup, body);
        const headLen = group.length - body.length;
        pushBlock(group, f, headLen + dataInGroup, alphaInGroup === null ? null : headLen + alphaInGroup);
      }
      if (o.extra) for (const extra of o.extra(c, k, g)) parts.push(extra);
    }
    const body = concat(parts);
    const bytes = o.unknownSize ? elUnknown(E.Cluster, body) : el(E.Cluster, body);
    const headLen = bytes.length - body.length;
    return { time: g.time, bytes, marks: marks.map((m) => ({ frame: m.frame, dataAt: headLen + m.dataAt, alphaAt: m.alphaAt === null ? null : headLen + m.alphaAt })) };
  });
}

// A whole Matroska file. tracks: [bytes of each TrackEntry]; frames as for clusters(). Returns { bytes, dataOffset:
// Map(frame → file offset), alphaOffset: Map }.
function matroska({ doc, tracks, frames, durationMs, unknownSize, cues, extra }) {
  const cl = clusters(frames, { unknownSize, extra });
  const info = el(E.Info, eu(E.TimestampScale, 1000000), ef64(E.Duration, durationMs), es(E.MuxingApp, 'mojipv fixtures'),
    es(E.WritingApp, 'make_media_fixtures.js'));
  const tracksEl = el(E.Tracks, ...tracks);
  const voidEl = el(E.Void, zeros(20));                         // where a SeekHead would go
  const head = concat([voidEl, info, tracksEl]);
  let at = head.length;
  const clusterAt = [];
  for (const c of cl) { clusterAt.push(at); at += c.bytes.length; }
  const cuesEl = cues ? el(E.Cues, ...cl.map((c, k) => el(E.CuePoint, eu(E.CueTime, c.time),
    el(E.CueTrackPositions, eu(E.CueTrack, 1), eu(E.CueClusterPosition, clusterAt[k]))))) : null;
  const body = concat([head, ...cl.map((c) => c.bytes), cuesEl]);
  const header = ebmlHeader(doc);
  const segment = unknownSize ? elUnknown(E.Segment, body) : el(E.Segment, body);
  const segBody = header.length + segment.length - body.length;
  const dataOffset = new Map(), alphaOffset = new Map();
  cl.forEach((c, k) => {
    for (const m of c.marks) {
      dataOffset.set(m.frame, segBody + clusterAt[k] + m.dataAt);
      if (m.alphaAt !== null) alphaOffset.set(m.frame, segBody + clusterAt[k] + m.alphaAt);
    }
  });
  return { bytes: concat([header, segment]), dataOffset, alphaOffset };
}

function videoTrack({ number = 1, codec, priv, defaultDuration, alphaMode, colour, w = W, h = H }) {
  const video = [eu(E.PixelWidth, w), eu(E.PixelHeight, h)];
  if (alphaMode) video.push(eu(E.AlphaMode, alphaMode));
  if (colour) video.push(el(E.Colour, eu(E.MatrixCoefficients, 1), eu(E.Range, 1), eu(E.TransferCharacteristics, 1), eu(E.Primaries, 1)));
  return el(E.TrackEntry, eu(E.TrackNumber, number), eu(E.TrackUID, 1000 + number), eu(E.TrackType, 1), eu(E.FlagLacing, 0),
    es(E.CodecID, codec), priv ? el(E.CodecPrivate, priv) : null, defaultDuration ? eu(E.DefaultDuration, defaultDuration) : null,
    alphaMode ? eu(E.MaxBlockAdditionID, 1) : null, el(E.Video, ...video));
}

// A VP9 key frame: a real uncompressed header (frame marker, profile, key frame, sync code, colour config), then filler.
function vp9Key(profile, depth, i, size) {
  const bits = [];
  const put = (v, n) => { for (let k = n - 1; k >= 0; k--) bits.push((v >> k) & 1); };
  put(2, 2); put(profile & 1, 1); put(profile >> 1, 1);
  if (profile === 3) put(0, 1);
  put(0, 1); put(0, 1); put(1, 1); put(0, 1);            // show_existing_frame, frame_type KEY, show_frame, error_resilient
  put(0x49, 8); put(0x83, 8); put(0x42, 8);
  if (profile >= 2) put(depth === 12 ? 1 : 0, 1);
  put(2, 3); put(0, 1);                                  // color_space BT_709, color_range studio
  while (bits.length % 8) bits.push(0);
  const out = payload('vp9', i, size);
  for (let k = 0; k < bits.length / 8; k++) out[k] = parseInt(bits.slice(8 * k, 8 * k + 8).join(''), 2);
  return out;
}

// A VP8 frame: the 3-byte frame tag (key frames add the start code and the size), then filler.
function vp8Frame(key, i, size) {
  const out = payload('vp8', i, size);
  const first = size - 3;
  out[0] = ((first << 5) & 0xe0) | (key ? 0 : 1) | 0x10; out[1] = (first >> 3) & 255; out[2] = (first >> 11) & 255;
  if (key) out.set([0x9d, 0x01, 0x2a, W & 255, W >> 8, H & 255, H >> 8], 3);
  return out;
}

// --- GIF ---------------------------------------------------------------------------------------------------------------------

// LZW for GIF: variable code size, the size grows when the next code needs another bit (no early change).
function lzw(indices, minSize) {
  const clear = 1 << minSize, eoi = clear + 1;
  let size = minSize + 1, next = eoi + 1;
  let table = new Map();
  const out = [];
  let acc = 0, nbits = 0;
  const emit = (code) => {
    acc |= code << nbits; nbits += size;
    while (nbits >= 8) { out.push(acc & 255); acc >>>= 8; nbits -= 8; }
  };
  emit(clear);
  let cur = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = cur * 256 + k;
    if (table.has(key)) { cur = table.get(key); continue; }
    emit(cur);
    if (next === 4096) {
      emit(clear);
      next = eoi + 1; size = minSize + 1; table = new Map();
    } else {
      if (next >= (1 << size)) size++;
      table.set(key, next++);
    }
    cur = k;
  }
  emit(cur);
  emit(eoi);
  if (nbits > 0) out.push(acc & 255);
  const blocks = [];
  for (let at = 0; at < out.length; at += 255) {
    const part = out.slice(at, at + 255);
    blocks.push(part.length, ...part);
  }
  return [minSize, ...blocks, 0];
}

function gif(frames, delays) {
  const palette = [0x10, 0x10, 0x10, 0xf0, 0xf0, 0xf0, 0xd0, 0x30, 0x30, 0x30, 0x70, 0xd0];
  const parts = ['GIF89a', u16le(W), u16le(H), [0x91, 0, 0], palette,
    [0x21, 0xff, 11], 'NETSCAPE2.0', [3, 1, 0, 0, 0]];
  frames.forEach((indices, k) => {
    parts.push([0x21, 0xf9, 4, 0x04, ...u16le(delays[k]), 0, 0]);          // disposal 1 (keep), delay in 1/100 s
    parts.push([0x2c, 0, 0, 0, 0, ...u16le(W), ...u16le(H), 0]);
    parts.push(lzw(indices, 2));
  });
  parts.push([0x3b]);
  return concat(parts);
}

function u16le(v) { return [v & 255, (v >> 8) & 255]; }

// Frame k of the animation: a light bar that moves one step right per frame, and k + 1 marks in the top row.
function gifFrame(k) {
  const out = new Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = 0;
      if (x >= k * 6 && x < k * 6 + 6) v = 1;
      if (y < 3 && x < (k + 1) * 4 && x % 4 < 3) v = 2;
      if (y >= H - 4 && (x + k) % 8 < 4) v = 3;
      out[y * W + x] = v;
    }
  }
  return out;
}

// --- the fixtures ------------------------------------------------------------------------------------------------------------

const round9 = (x) => Math.round(x * 1e9) / 1e9;

// The expected table of a track, from the written decode-order samples: cts (ticks), dur (ticks), key, off, size;
// start = the edit media_time (samples before it are pre-roll).
function expectTable(timescale, samples, offsets, start, extra) {
  const nd = samples.length;
  const shown = [];
  for (let d = 0; d < nd; d++) if (start === undefined || samples[d].cts >= start) shown.push(d);
  shown.sort((a, b) => samples[a].cts - samples[b].cts);
  const shift = samples[shown[0]].cts;
  const pts = shown.map((d) => round9((samples[d].cts - shift) / timescale));
  const dec = shown.slice();
  const lastDur = samples[shown[shown.length - 1]].dur / timescale;
  const dur = pts.map((p, i) => (i + 1 < pts.length ? round9(pts[i + 1] - p) : round9(lastDur)));
  const ts = samples.map((s) => Math.round(((s.cts - shift) / timescale) * 1e6));
  return Object.assign({
    n: shown.length, duration: round9(pts[pts.length - 1] + dur[dur.length - 1]),
    pts, dur, dec, key: samples.map((s) => (s.key ? 1 : 0)), off: offsets, size: samples.map((s) => s.size), ts,
  }, extra || {});
}

function bframesMp4() {
  const order = bOrder(FRAMES, 10);
  const samples = order.map((p, d) => ({ size: sizeOf(d), dur: 512, cts: p * 512 + 1024, cto: (p + 2 - d) * 512, key: p % 10 === 0 }));
  const edits = [[200, -1], [960, 1536]];      // an empty edit (ignored), then media_time 1536: frame 0 is pre-roll
  const m = movie({ ftyp: box('ftyp', 'isom', u32(512), 'isom', 'iso2', 'avc1', 'mp41'), fast: false, movieScale: 1000, movieDuration: 1160,
    tracks: [{ id: 1, tag: 'bfr', timescale: 12800, samples, entry: visualEntry('avc1', W, H, box('avcC', avcC(0x64, 0x00, 0x0a))), per: 5, edits }] });
  return { bytes: m.bytes, expect: { sniff: ['video', 'mp4', 'video/mp4'], brand: 'isom', tracks: ['video'],
    video: { codec: 'avc1.64000A', w: W, h: H, codedW: W, codedH: H, rot: 0, alpha: false, description: 'avcC',
      table: expectTable(12800, samples, m.offsets[0], 1536, { preroll: 1 }) } },
    what: 'H.264 (avc1, High) with B-frames (I P B B, GOP 10), ctts version 0, an edit list with an empty edit and then media_time 1536 (frame 0 is pre-roll: fed, never shown), moov after mdat, 5 samples per chunk',
    ffmpeg: 'ffmpeg -f lavfi -i testsrc2=size=64x36:rate=25 -t 1 -c:v libx264 -bf 2 -g 10 bframes.mp4' };
}

function fragMp4() {
  const order = bOrder(FRAMES, 10);
  const samples = order.map((p, d) => ({ size: sizeOf(d), dur: 512, cts: p * 512, cto: (p - d) * 512, key: p % 10 === 0 }));
  const ftyp = box('ftyp', 'iso5', u32(512), 'iso5', 'iso6', 'mp41');
  const entry = visualEntry('avc1', W, H, box('avcC', avcC(0x4d, 0x40, 0x0d)));
  const emptyStbl = box('stbl', full('stsd', 0, 0, u32(1), entry), full('stts', 0, 0, u32(0)), full('stsc', 0, 0, u32(0)),
    full('stsz', 0, 0, u32(0), u32(0)), full('stco', 0, 0, u32(0)));
  const moov = box('moov', mvhd(1000, 0, 2),
    box('trak', tkhd(1, 0, 0, W, H, false), box('mdia', mdhd(12800, 0), hdlr('vide'),
      box('minf', full('vmhd', 0, 1, zeros(8)), box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))), emptyStbl))),
    box('mvex', full('trex', 0, 0, u32(1), u32(1), u32(512), u32(0), u32(0x01010000))));
  const parts = [ftyp, moov];
  let at = ftyp.length + moov.length;
  const offsets = [];
  for (let g = 0, seq = 1; g < FRAMES; g += 10, seq++) {
    const group = samples.slice(g, Math.min(FRAMES, g + 10));
    const trunOf = (dataOffset) => full('trun', 1, 0x1 | 0x4 | 0x200 | 0x800, u32(group.length), i32(dataOffset), u32(0x02000000),
      ...group.map((s) => [...u32(s.size), ...i32(s.cto)]));
    const moofOf = (dataOffset) => box('moof', full('mfhd', 0, 0, u32(seq)),
      box('traf', full('tfhd', 0, 0x020000 | 0x08, u32(1), u32(512)), full('tfdt', 1, 0, u64(g * 512)), trunOf(dataOffset)));
    const size = moofOf(0).length;
    const moof = moofOf(size + 8);
    const data = group.map((s, k) => payload('frg', g + k, s.size));
    let p = at + size + 8;
    for (const d of data) { offsets.push(p); p += d.length; }
    const mdat = concat([u32(8 + data.reduce((n, d) => n + d.length, 0)), 'mdat', ...data]);
    parts.push(moof, mdat);
    at += moof.length + mdat.length;
  }
  return { bytes: concat(parts), expect: { sniff: ['video', 'mp4', 'video/mp4'], brand: 'iso5', tracks: ['video'],
    video: { codec: 'avc1.4D400D', w: W, h: H, codedW: W, codedH: H, rot: 0, alpha: false, description: 'avcC',
      table: expectTable(12800, samples, offsets) } },
    what: 'fragmented MP4: an empty moov with mvex/trex, one moof (tfhd default-base-is-moof, tfdt version 1, trun version 1 with signed composition offsets and first_sample_flags) plus mdat per GOP of 10, B-frames',
    ffmpeg: 'ffmpeg -f lavfi -i testsrc2=size=64x36:rate=25 -t 1 -c:v libx264 -bf 2 -g 10 -movflags +frag_keyframe+empty_moov frag.mp4' };
}

function rot90Mp4() {
  const samples = Array.from({ length: FRAMES }, (_, d) => ({ size: sizeOf(d), dur: 512, cts: d * 512, cto: 0, key: d % 10 === 0 }));
  const colr = box('colr', 'nclx', u16(1), u16(1), u16(1), [0]);
  const m = movie({ ftyp: box('ftyp', 'isom', u32(512), 'isom', 'iso2', 'avc1', 'mp41'), fast: true, movieScale: 1000, movieDuration: 1000,
    tracks: [{ id: 1, tag: 'r90', timescale: 12800, samples, entry: visualEntry('avc1', W, H, box('avcC', avcC(0x42, 0xc0, 0x0a)), colr), per: 25,
      rot: 90, opts: { co64: true } }] });
  return { bytes: m.bytes, expect: { sniff: ['video', 'mp4', 'video/mp4'], brand: 'isom', tracks: ['video'],
    video: { codec: 'avc1.42C00A', w: H, h: W, codedW: W, codedH: H, rot: 90, alpha: false, description: 'avcC',
      color: { primaries: 1, transfer: 1, matrix: 1, fullRange: false }, table: expectTable(12800, samples, m.offsets[0]) } },
    what: 'a 90° track matrix (displayed 36×64), colr nclx BT.709 limited range, co64 chunk offsets, moov before mdat, key frames every 10',
    ffmpeg: 'ffmpeg -f lavfi -i testsrc2=size=64x36:rate=25 -t 1 -c:v libx264 -bf 0 -g 10 -metadata:s:v rotate=90 -movflags +faststart rot90.mp4' };
}

function clipMov() {
  const samples = Array.from({ length: FRAMES }, (_, d) => ({ size: 64, dur: 100, cts: d * 100, cto: 0, key: true }));
  const audio = Array.from({ length: 4 }, (_, d) => ({ size: 32, dur: 12000, cts: d * 12000, cto: 0, key: true }));
  const colr = box('colr', 'nclc', u16(1), u16(1), u16(1));
  const m = movie({ ftyp: box('ftyp', 'qt  ', u32(0x20050300), 'qt  '), pre: [box('wide')], fast: false, movieScale: 600, movieDuration: 600,
    tracks: [
      { id: 1, tag: 'mov', timescale: 2500, samples, entry: visualEntry('avc1', W, H, box('avcC', avcC(0x4d, 0x40, 0x15)), colr), per: 25,
        qt: true, edits: [[600, 0]], opts: { fixedSize: 64 } },
      { id: 2, tag: 'snd', timescale: 48000, samples: audio, entry: soundEntry('sowt'), per: 4, qt: true, audio: true },
    ] });
  return { bytes: m.bytes, expect: { sniff: ['video', 'mov', 'video/quicktime'], brand: 'qt  ', tracks: ['video', 'audio'],
    video: { codec: 'avc1.4D4015', w: W, h: H, codedW: W, codedH: H, rot: 0, alpha: false, description: 'avcC',
      color: { primaries: 1, transfer: 1, matrix: 1, fullRange: null }, table: expectTable(2500, samples, m.offsets[0], 0) } },
    what: "QuickTime: ftyp 'qt  ', a 'wide' box, colr nclc, a constant sample size (stsz), no stss (every frame a key frame), an edit with media_time 0, and a sound track ('sowt'); moov at the end",
    ffmpeg: 'ffmpeg -f lavfi -i testsrc2=size=64x36:rate=25 -f lavfi -i sine=r=48000 -t 1 -c:v libx264 -g 1 -c:a pcm_s16le clip.mov' };
}

function proresMov() {
  const samples = Array.from({ length: FRAMES }, (_, d) => ({ size: 80 + (d % 5), dur: 512, cts: d * 512, cto: 0, key: true }));
  const m = movie({ ftyp: box('ftyp', 'qt  ', u32(0x20050300), 'qt  '), fast: false, movieScale: 1000, movieDuration: 1000,
    tracks: [{ id: 1, tag: 'apch', timescale: 12800, samples, entry: visualEntry('apch', W, H), per: 25, qt: true }] });
  return { bytes: m.bytes, expect: { sniff: ['video', 'mov', 'video/quicktime'], brand: 'qt  ', tracks: ['video'],
    video: { codec: 'apch', w: W, h: H, codedW: W, codedH: H, rot: 0, alpha: false, description: null, warning: 'codec:apch',
      table: expectTable(12800, samples, m.offsets[0]) } },
    what: "ProRes 4444-style sample entry 'apch' (placeholder frames): the demuxer keeps the codec string, and the import refuses it (media.err.codec)",
    ffmpeg: 'ffmpeg -f lavfi -i testsrc2=size=64x36:rate=25 -t 1 -c:v prores_ks -profile:v 4444 prores.mov' };
}

function vp9Webm() {
  const frames = Array.from({ length: FRAMES }, (_, i) => ({ time: i * 40, key: i % 10 === 0,
    data: i % 10 === 0 ? vp9Key(0, 8, i, sizeOf(i)) : payload('vp9', i, sizeOf(i)) }));
  const track = videoTrack({ codec: 'V_VP9', defaultDuration: 40000000, colour: true });
  const mk = matroska({ doc: 'webm', tracks: [track], frames, durationMs: 1000, cues: true });
  const samples = frames.map((f, i) => ({ cts: f.time, dur: 40, key: f.key, size: f.data.length }));
  return { bytes: mk.bytes, expect: { sniff: ['video', 'webm', 'video/webm'], brand: 'webm', tracks: ['video'],
    video: { codec: 'vp09.00.10.08', w: W, h: H, codedW: W, codedH: H, rot: 0, alpha: false, description: null,
      color: { primaries: 1, transfer: 1, matrix: 1, fullRange: false },
      table: expectTable(1000, samples, frames.map((f) => mk.dataOffset.get(f))) } },
    what: 'VP9 in WebM (profile 0, 8 bit, read from the first key frame\'s uncompressed header), SimpleBlocks, a Cluster per key frame (GOP 10), DefaultDuration, Colour BT.709, Cues',
    ffmpeg: 'ffmpeg -f lavfi -i testsrc2=size=64x36:rate=25 -t 1 -c:v libvpx-vp9 -g 10 vp9.webm' };
}

function alphaVp8Webm() {
  const frames = Array.from({ length: FRAMES }, (_, i) => ({ time: i * 40, key: i === 0, group: true,
    data: vp8Frame(i === 0, i, sizeOf(i)), alpha: vp8Frame(i === 0, 100 + i, 20 + ((i * 5) % 11)) }));
  const track = videoTrack({ codec: 'V_VP8', defaultDuration: 40000000, alphaMode: 1 });
  const mk = matroska({ doc: 'webm', tracks: [track], frames, durationMs: 1000, cues: true });
  const samples = frames.map((f) => ({ cts: f.time, dur: 40, key: f.key, size: f.data.length }));
  return { bytes: mk.bytes, expect: { sniff: ['video', 'webm', 'video/webm'], brand: 'webm', tracks: ['video'],
    video: { codec: 'vp8', w: W, h: H, codedW: W, codedH: H, rot: 0, alpha: true, description: null,
      table: expectTable(1000, samples, frames.map((f) => mk.dataOffset.get(f)), undefined, {
        aoff: frames.map((f) => mk.alphaOffset.get(f)), asize: frames.map((f) => f.alpha.length) }) } },
    what: 'VP8 with alpha: AlphaMode 1, MaxBlockAdditionID 1, a BlockGroup per frame (Block, BlockAdditions/BlockMore/BlockAddID 1/BlockAdditional, ReferenceBlock on delta frames); one key frame',
    ffmpeg: 'ffmpeg -f lavfi -i testsrc2=size=64x36:rate=25,format=yuva420p -t 1 -c:v libvpx -auto-alt-ref 0 alpha_vp8.webm' };
}

function av1Webm() {
  const av1c = [0x81, 0x00, 0x0c, 0x00, 0x0a, 0x0b, 0x00, 0x00, 0x00, 0x24, 0xcf, 0x7f, 0x0d, 0xbf, 0xff, 0x30, 0x08];
  const frames = Array.from({ length: FRAMES }, (_, i) => ({ time: i * 40, key: i % 12 === 0, data: payload('av1', i, sizeOf(i)) }));
  const track = videoTrack({ codec: 'V_AV1', priv: av1c, defaultDuration: 40000000 });
  const mk = matroska({ doc: 'webm', tracks: [track], frames, durationMs: 1000, unknownSize: true });
  const samples = frames.map((f) => ({ cts: f.time, dur: 40, key: f.key, size: f.data.length }));
  return { bytes: mk.bytes, expect: { sniff: ['video', 'webm', 'video/webm'], brand: 'webm', tracks: ['video'],
    video: { codec: 'av01.0.00M.08', w: W, h: H, codedW: W, codedH: H, rot: 0, alpha: false, description: 'CodecPrivate',
      table: expectTable(1000, samples, frames.map((f) => mk.dataOffset.get(f))) } },
    what: 'AV1 in WebM: CodecPrivate = av1C (profile 0, level 2.0, main tier, 8 bit), a Segment and Clusters of unknown size (as a live recorder writes them), key frames at 0, 12 and 24',
    ffmpeg: 'ffmpeg -f lavfi -i testsrc2=size=64x36:rate=25 -t 1 -c:v libaom-av1 -cpu-used 8 -g 12 -live 1 av1.webm' };
}

// Xiph lacing: the number of frames − 1, then each size but the last as a run of 255s plus the rest.
function xiphLaced(track, rel, sizes, tag) {
  const head = [0x80 | track, (rel >> 8) & 255, rel & 255, 0x02 | 0x80, sizes.length - 1];
  for (const s of sizes.slice(0, -1)) { let v = s; while (v >= 255) { head.push(255); v -= 255; } head.push(v); }
  return el(E.SimpleBlock, head, ...sizes.map((s, k) => payload(tag, k, s)));
}

function lacedMkv() {
  const avcc = avcC(0x42, 0xc0, 0x0a);
  const frames = Array.from({ length: FRAMES }, (_, i) => ({ time: i * 40, key: i % 10 === 0, data: payload('mkv', i, sizeOf(i)),
    group: i === FRAMES - 1, duration: i === FRAMES - 1 ? 40 : 0 }));
  const video = videoTrack({ codec: 'V_MPEG4/ISO/AVC', priv: avcc });
  const opusHead = [...Buffer.from('OpusHead', 'latin1'), 1, 2, 0x38, 0x01, 0x80, 0xbb, 0, 0, 0, 0, 0];
  const audioTrack = el(E.TrackEntry, eu(E.TrackNumber, 2), eu(E.TrackUID, 1002), eu(E.TrackType, 2), eu(E.FlagLacing, 1),
    es(E.CodecID, 'A_OPUS'), el(E.CodecPrivate, opusHead), el(E.Audio, ef64(E.SamplingFrequency, 48000), eu(E.Channels, 2)));
  // After every 4th video frame: an audio block of 3 Xiph-laced frames, one of them longer than 255 bytes.
  const extra = (c, k, g) => (k % 4 === 3 ? [xiphLaced(2, g.frames[k].time - g.time, [40, 300, 17], 'opu')] : []);
  const mk = matroska({ doc: 'matroska', tracks: [video, audioTrack], frames, durationMs: 1000, cues: false, extra });
  const samples = frames.map((f) => ({ cts: f.time, dur: f.duration, key: f.key, size: f.data.length }));
  const table = expectTable(1000, samples, frames.map((f) => mk.dataOffset.get(f)));
  return { bytes: mk.bytes, expect: { sniff: ['video', 'matroska', 'video/x-matroska'], brand: 'matroska', tracks: ['video', 'audio'],
    video: { codec: 'avc1.42C00A', w: W, h: H, codedW: W, codedH: H, rot: 0, alpha: false, description: 'CodecPrivate', table } },
    what: 'Matroska (DocType matroska): an H.264 video track (V_MPEG4/ISO/AVC, no DefaultDuration; the last frame is a BlockGroup with BlockDuration 40) and an Opus track whose SimpleBlocks use Xiph lacing (skipped by the demuxer)',
    ffmpeg: 'ffmpeg -f lavfi -i testsrc2=size=64x36:rate=25 -f lavfi -i sine=r=48000 -t 1 -c:v libx264 -g 10 -c:a libvorbis laced.mkv' };
}

function animGif() {
  const delays = [10, 10, 10, 10, 10, 10, 10, 10, 10, 20];
  return { bytes: gif(Array.from({ length: 10 }, (_, k) => gifFrame(k)), delays),
    expect: { sniff: ['image', 'gif', 'image/gif'], w: W, h: H, anim: true, frames: 10, delays },
    what: 'an animated GIF89a: 10 frames of 64×36 (4 colours, real LZW data), NETSCAPE2.0 loop, delays 0.1 s (the last 0.2 s)',
    ffmpeg: 'ffmpeg -f lavfi -i testsrc2=size=64x36:rate=10 -frames:v 10 anim.gif' };
}

function heic() {
  const ispe = full('ispe', 0, 0, u32(1), u32(1));
  const meta = full('meta', 0, 0, full('hdlr', 0, 0, u32(0), 'pict', zeros(12), [0]), full('pitm', 0, 0, u16(1)),
    box('iprp', box('ipco', ispe)));
  return { bytes: concat([box('ftyp', 'heic', u32(0), 'mif1', 'heic'), meta]),
    expect: { sniff: ['heic', 'heif', 'image/heic'] },
    what: 'a HEIC header only (ftyp heic with mif1, a meta box with ispe 1×1): the import refuses it with media.err.heic',
    ffmpeg: '(no ffmpeg recipe: take any 1×1 HEIC photo and keep its first 200 bytes)' };
}

const FIXTURES = [
  ['bframes.mp4', bframesMp4], ['frag.mp4', fragMp4], ['rot90.mp4', rot90Mp4], ['clip.mov', clipMov], ['vp9.webm', vp9Webm],
  ['alpha_vp8.webm', alphaVp8Webm], ['av1.webm', av1Webm], ['laced.mkv', lacedMkv], ['anim.gif', animGif],
  ['prores.mov', proresMov], ['heic.heic', heic],
];

function listLine(key, values) { return key.padEnd(10) + values.join(' '); }

// build() → { files: Map(name → Uint8Array), expected: { [name]: expect }, make: MAKE.txt text }
function build() {
  const files = new Map(), expected = {};
  const lines = [
    '文字PVメーカー v2 — original work. The committed demuxer fixtures of DESIGN_2_1 §11.8.1.',
    '',
    'MADE BY: node tests/helpers/make_media_fixtures.js --write   (it writes every file below and this MAKE.txt)',
    '',
    'Why not ffmpeg: the environment that made them has no ffmpeg. The generator writes the container structures',
    'byte by byte (ISO BMFF boxes, EBML elements, GIF blocks); codec payloads are placeholder bytes wherever the demuxers',
    'do not decode them (a VP9 key frame starts with a real uncompressed header, and anim.gif is a real, decodable GIF).',
    'So the H.264, VP8, VP9 and AV1 clips here demux exactly but do not decode: real decoding is tested in the browser',
    'with the counter videos of tests/helpers/media_gen.js. Each file may later be replaced by its "ffmpeg" line; the',
    'tables below then have to be dumped again (ffprobe -show_packets) and the test updated with them.',
    '',
    'Tables: "pres" rows are in presentation order (pts, dur in seconds, dec = decode index); the other rows are in',
    'decode order (key, off = byte offset in the file, size, ts = the chunk timestamp in µs, aoff/asize = WebM alpha).',
    'Pre-roll samples are in the decode rows only. tests/node/media_demux.test.js reads this file.',
  ];
  for (const [name, make] of FIXTURES) {
    const f = make();
    files.set(name, f.bytes);
    expected[name] = f.expect;
    lines.push('', '[' + name + ']', listLine('what', [f.what]), listLine('ffmpeg', [f.ffmpeg]), listLine('bytes', [f.bytes.length]),
      listLine('sniff', f.expect.sniff));
    if (f.expect.video) {
      const v = f.expect.video, t = v.table;
      lines.push(listLine('brand', [JSON.stringify(f.expect.brand)]), listLine('tracks', f.expect.tracks),
        listLine('video', ['codec=' + v.codec, 'w=' + v.w, 'h=' + v.h, 'codedW=' + v.codedW, 'codedH=' + v.codedH, 'rot=' + v.rot,
          'alpha=' + v.alpha, 'description=' + (v.description || 'none')]));
      if (v.color) lines.push(listLine('color', ['primaries=' + v.color.primaries, 'transfer=' + v.color.transfer, 'matrix=' + v.color.matrix,
        'fullRange=' + v.color.fullRange]));
      if (v.warning) lines.push(listLine('warning', [v.warning]));
      lines.push(listLine('n', [t.n]), listLine('duration', [t.duration]));
      for (const k of ['pts', 'dur', 'dec']) lines.push(listLine('pres.' + k, t[k]));
      for (const k of ['key', 'off', 'size', 'ts', 'aoff', 'asize']) if (t[k]) lines.push(listLine('dec.' + k, t[k]));
    } else if (f.expect.frames) {
      lines.push(listLine('image', ['w=' + f.expect.w, 'h=' + f.expect.h, 'anim=' + f.expect.anim, 'frames=' + f.expect.frames]),
        listLine('delays', f.expect.delays));
    }
  }
  return { files, expected, make: lines.join('\n') + '\n' };
}

// parseMake(text) → { [name]: { key: [values] } }: the reader the test uses.
function parseMake(text) {
  const out = {};
  let cur = null;
  for (const line of text.split('\n')) {
    const head = /^\[(.+)\]$/.exec(line);
    if (head) { cur = out[head[1]] = {}; continue; }
    if (!cur || !line.trim()) continue;
    const m = /^(\S+)\s+(.*)$/.exec(line);
    if (m) cur[m[1]] = m[2].split(' ');
  }
  return out;
}

module.exports = { build, parseMake, FIXTURES: FIXTURES.map((f) => f[0]), W, H, FPS, FRAMES, helpers: {
  concat, box, full, el, elUnknown, eu, es, ebmlHeader, videoTrack, blockHead, matroska, E, payload, vp9Key, vp8Frame, avcC,
  visualEntry, movie, bOrder, lzw, gif, gifFrame, sizeBytes } };

if (require.main === module) {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.resolve(__dirname, '..', 'fixtures', 'media');
  if (!process.argv.includes('--write')) {
    console.log('usage: node tests/helpers/make_media_fixtures.js --write   (writes ' + dir + ')');
    process.exit(2);
  }
  fs.mkdirSync(dir, { recursive: true });
  const { files, make } = build();
  for (const [name, bytes] of files) {
    if (bytes.length >= 24 * 1024) throw new Error(name + ' is ' + bytes.length + ' bytes (the limit is 24 KB)');
    fs.writeFileSync(path.join(dir, name), bytes);
  }
  fs.writeFileSync(path.join(dir, 'MAKE.txt'), make);
  console.log('wrote ' + files.size + ' fixtures and MAKE.txt to ' + dir);
}
