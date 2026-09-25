/* 文字PVメーカー v2 — original work. Tests for export/webm (DESIGN_2_1 §13.12 webm.test.js): an own EBML reader checks the element tree, patches, blocks, alpha, cues and audio. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { throwsCode } = require('../helpers/assert_plus.js');

const MV = load();
const W = MV.use('export/webm');
const S = MV.use('export/schedule');
const SINK = MV.use('export/host/sink');
const rng = MV.use('core/rng');

// --- an independent EBML reader (element ids written out from the Matroska specification, not taken from W.IDS) ------

const NAMES = {
  0x1a45dfa3: 'EBML', 0x4286: 'EBMLVersion', 0x42f7: 'EBMLReadVersion', 0x42f2: 'EBMLMaxIDLength', 0x42f3: 'EBMLMaxSizeLength',
  0x4282: 'DocType', 0x4287: 'DocTypeVersion', 0x4285: 'DocTypeReadVersion', 0xec: 'Void', 0x18538067: 'Segment',
  0x114d9b74: 'SeekHead', 0x4dbb: 'Seek', 0x53ab: 'SeekID', 0x53ac: 'SeekPosition',
  0x1549a966: 'Info', 0x2ad7b1: 'TimestampScale', 0x4489: 'Duration', 0x4d80: 'MuxingApp', 0x5741: 'WritingApp',
  0x1654ae6b: 'Tracks', 0xae: 'TrackEntry', 0xd7: 'TrackNumber', 0x73c5: 'TrackUID', 0x83: 'TrackType', 0x9c: 'FlagLacing',
  0x86: 'CodecID', 0x63a2: 'CodecPrivate', 0x56aa: 'CodecDelay', 0x56bb: 'SeekPreRoll', 0x23e383: 'DefaultDuration',
  0x55ee: 'MaxBlockAdditionID', 0x41e4: 'BlockAdditionMapping', 0x41f0: 'BlockAddIDValue', 0x41e7: 'BlockAddIDType',
  0xe0: 'Video', 0xb0: 'PixelWidth', 0xba: 'PixelHeight', 0x53c0: 'AlphaMode', 0xe1: 'Audio', 0xb5: 'SamplingFrequency',
  0x9f: 'Channels', 0x1f43b675: 'Cluster', 0xe7: 'Timestamp', 0xa3: 'SimpleBlock', 0xa0: 'BlockGroup', 0xa1: 'Block',
  0x75a1: 'BlockAdditions', 0xa6: 'BlockMore', 0xee: 'BlockAddID', 0xa5: 'BlockAdditional', 0xfb: 'ReferenceBlock',
  0x1c53bb6b: 'Cues', 0xbb: 'CuePoint', 0xb3: 'CueTime', 0xb7: 'CueTrackPositions', 0xf7: 'CueTrack', 0xf1: 'CueClusterPosition',
};
const MASTERS = new Set(['EBML', 'Segment', 'SeekHead', 'Seek', 'Info', 'Tracks', 'TrackEntry', 'BlockAdditionMapping', 'Video',
  'Audio', 'Cluster', 'BlockGroup', 'BlockAdditions', 'BlockMore', 'Cues', 'CuePoint', 'CueTrackPositions']);

// A variable-length integer at `at`: { value, len, unknown }. With `marker`, the value keeps its length marker (ids).
function readVint(bytes, at, marker) {
  const first = bytes[at];
  assert.ok(first !== 0 && first !== undefined, 'a vint at ' + at);
  let len = 1;
  while (!(first & (0x80 >> (len - 1)))) len++;
  const mask = 0xff >> len;
  let value = marker ? first : first & mask;
  let ones = (first & mask) === mask;
  for (let k = 1; k < len; k++) {
    value = value * 256 + bytes[at + k];
    if (bytes[at + k] !== 0xff) ones = false;
  }
  return { value, len, unknown: !marker && ones };
}

// parse(bytes) → the element tree: { name, id, at, idLen, sizeLen, size, dataAt, end, children | data }.
function parse(bytes, from = 0, to = bytes.length) {
  const out = [];
  let at = from;
  while (at < to) {
    const id = readVint(bytes, at, true);
    const sz = readVint(bytes, at + id.len, false);
    const name = NAMES[id.value];
    assert.ok(name, 'known element id 0x' + id.value.toString(16) + ' at ' + at);
    const dataAt = at + id.len + sz.len;
    const end = sz.unknown ? to : dataAt + sz.value;
    assert.ok(end <= to, name + ' at ' + at + ' fits in its parent');
    const node = { name, id: id.value, at, idLen: id.len, sizeLen: sz.len, size: sz.unknown ? null : sz.value, dataAt, end };
    if (MASTERS.has(name)) node.children = parse(bytes, dataAt, end);
    else node.data = bytes.subarray(dataAt, end);
    out.push(node);
    at = end;
  }
  assert.equal(at, to, 'elements end exactly at their parent\'s end');
  return out;
}

function u(data) { let v = 0; for (const b of data) v = v * 256 + b; return v; }
function s(data) { let v = u(data); if (data.length && data[0] & 0x80) v -= 2 ** (8 * data.length); return v; }
function f(data) {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return data.length === 4 ? v.getFloat32(0) : v.getFloat64(0);
}
function txt(data) { return String.fromCharCode(...data); }
function hex(bytes) { return Buffer.from(bytes).toString('hex'); }
const kids = (node, name) => node.children.filter((c) => c.name === name);
const kid = (node, name) => { const k = kids(node, name); assert.equal(k.length, 1, 'one ' + name + ' in ' + node.name); return k[0]; };
const val = (node, name, read = u) => read(kid(node, name).data);
function shape(nodes) {
  return nodes.map((n) => (n.children ? n.name + '[' + shape(n.children) + ']' : n.name)).join(',');
}

// A block (SimpleBlock or Block) body: track, time relative to the cluster, flags, frame range.
function blockOf(node) {
  const track = readVint(node.data, 0, false);
  const b = node.data;
  const rel = ((b[track.len] << 8) | b[track.len + 1]) << 16 >> 16;
  const flags = b[track.len + 2];
  return { track: track.value, rel, flags, off: node.dataAt + track.len + 3, size: node.end - node.dataAt - track.len - 3 };
}

// The whole file read back: the tree, the segment, and the sample table per track (decode order) with the
// cluster, alpha payload ranges and reference values of every block.
function readFile(bytes) {
  const top = parse(bytes);
  assert.deepEqual(top.map((n) => n.name), ['EBML', 'Segment']);
  const seg = top[1];
  const rows = [];
  const clusters = [];
  for (const cl of kids(seg, 'Cluster')) {
    const cms = val(cl, 'Timestamp');
    assert.equal(cl.children[0].name, 'Timestamp', 'the cluster Timestamp comes first');
    clusters.push({ ms: cms, pos: cl.at - seg.dataAt, node: cl });
    for (const c of cl.children.slice(1)) {
      if (c.name === 'SimpleBlock') {
        const blk = blockOf(c);
        assert.equal(blk.flags & 0x7f, 0, 'no lacing, not invisible');
        rows.push({ track: blk.track, ms: cms + blk.rel, rel: blk.rel, key: !!(blk.flags & 0x80), off: blk.off, size: blk.size,
          aoff: null, asize: null, ref: null, simple: true, cluster: clusters.length - 1 });
      } else {
        assert.equal(c.name, 'BlockGroup');
        const blk = blockOf(kid(c, 'Block'));
        assert.equal(blk.flags, 0, 'Block flags are 0');
        const refs = kids(c, 'ReferenceBlock');
        const adds = kids(c, 'BlockAdditions');
        let aoff = null, asize = null;
        if (adds.length) {
          const more = kid(adds[0], 'BlockMore');
          assert.equal(val(more, 'BlockAddID'), 1);
          const a = kid(more, 'BlockAdditional');
          aoff = a.dataAt;
          asize = a.end - a.dataAt;
        }
        rows.push({ track: blk.track, ms: cms + blk.rel, rel: blk.rel, key: refs.length === 0, off: blk.off, size: blk.size, aoff, asize,
          ref: refs.length ? s(refs[0].data) : null, simple: false, cluster: clusters.length - 1 });
      }
    }
  }
  return { top, seg, rows, clusters };
}

// --- inputs ---------------------------------------------------------------------------------------------------------

function collector() {
  const calls = [];
  let file = new Uint8Array(0);
  return {
    calls,
    write(bytes, position) {
      assert.ok(bytes instanceof Uint8Array, 'write receives a Uint8Array');
      calls.push({ n: bytes.length, position, bytes: bytes.slice() });
      const at = position === undefined ? file.length : position;
      if (at + bytes.length > file.length) {
        const grown = new Uint8Array(at + bytes.length);
        grown.set(file);
        file = grown;
      }
      file.set(bytes, at);
    },
    get bytes() { return file; },
  };
}

// Deterministic payload bytes for frame i of stream `tag` with length n.
function payload(tag, i, n) {
  const out = new Uint8Array(n);
  for (let k = 0; k < n; k++) out[k] = (tag * 31 + i * 7 + k * 13) & 255;
  return out;
}

const OPTS = { w: 64, h: 36, fps: 30, video: { codec: 'V_VP9', alpha: true }, audio: null };

// Writes a file: frames [{ ts, key, colour, alpha }], packets [{ ts, data }]; `order` interleaves the calls:
// 'video-first', 'audio-first', or an array of 'v' / 'a'. → Promise<{ bytes, result, calls }>.
async function writeFile(opts, frames, packets = [], order = 'mixed') {
  const sink = collector();
  const w = W.createWebm(Object.assign({}, opts, { write: sink.write }));
  let seq = order;
  if (order === 'video-first') seq = frames.map(() => 'v').concat(packets.map(() => 'a'));
  else if (order === 'audio-first') seq = packets.map(() => 'a').concat(frames.map(() => 'v'));
  else if (!Array.isArray(order)) {
    seq = [];
    let i = 0, j = 0;
    while (i < frames.length || j < packets.length) {
      if (j >= packets.length || (i < frames.length && frames[i].ts <= packets[j].ts)) { seq.push('v'); i++; } else { seq.push('a'); j++; }
    }
  }
  let i = 0, j = 0;
  for (const c of seq) {
    if (c === 'v') { const fr = frames[i++]; w.video(fr.colour, fr.alpha, fr.key, fr.ts); } else { const p = packets[j++]; w.audio(p.data, p.ts); }
  }
  const result = await w.finish();
  return { bytes: sink.bytes, result, calls: sink.calls };
}

function makeFrames(n, fps, { alpha = true, keyEvery = 2 * fps, size = (i) => 20 + (i % 5) } = {}) {
  const frames = [];
  for (let i = 0; i < n; i++) {
    frames.push({ ts: S.ts(i, fps), key: i % Math.round(keyEvery) === 0, colour: payload(1, i, size(i)),
      alpha: alpha ? payload(2, i, 5 + (i % 3)) : null });
  }
  return frames;
}

function makePackets(untilUs, stepUs = 20000) {
  const out = [];
  for (let k = 0, ts = 0; ts < untilUs; k++, ts = k * stepUs) out.push({ ts, data: payload(3, k, 3 + (k % 4)) });
  return out;
}

// --- EBML primitives ------------------------------------------------------------------------------------------------

test('ebmlSize: the shortest variable-length integer, with each width\'s all-ones value reserved for "unknown"', () => {
  const table = [
    [0, '80'], [1, '81'], [126, 'fe'], [127, '407f'], [16382, '7ffe'], [16383, '203fff'], [2 ** 21 - 2, '3ffffe'],
    [2 ** 21 - 1, '101fffff'], [2 ** 28 - 2, '1ffffffe'], [2 ** 28 - 1, '080fffffff'], [2 ** 35 - 2, '0ffffffffe'],
    [2 ** 35 - 1, '0407ffffffff'], [2 ** 42 - 1, '0203ffffffffff'], [2 ** 49 - 1, '0101ffffffffffff'],
    [Number.MAX_SAFE_INTEGER, '011fffffffffffff'],
  ];
  for (const [n, want] of table) assert.equal(hex(W.ebmlSize(n)), want, 'size ' + n);
  assert.equal(hex(W.ebmlSize(5, 8)), '0100000000000005', 'a fixed width of 8 (the Segment size)');
  assert.equal(hex(W.ebmlSize(126, 2)), '407e');
  assert.equal(hex(W.ebmlSize(0, 4)), '10000000');
  throwsCode(() => W.ebmlSize(127, 1), 'args', '127 does not fit one byte');
  throwsCode(() => W.ebmlSize(-1), 'args');
  throwsCode(() => W.ebmlSize(1.5), 'args');
  throwsCode(() => W.ebmlSize(2 ** 53), 'args');
  throwsCode(() => W.ebmlSize(1, 9), 'args');
  const r = rng.fromSeed(7);
  for (let k = 0; k < 2000; k++) {
    const bits = 1 + Math.floor(r.next() * 52);
    const n = Math.floor(r.next() * 2 ** bits);
    const bytes = W.ebmlSize(n);
    const back = readVint(bytes, 0, false);
    assert.equal(back.value, n);
    assert.equal(back.len, bytes.length);
    assert.equal(back.unknown, false, 'never the reserved all-ones value');
    let w = 1;
    while (n > 2 ** (7 * w) - 2) w++;
    assert.equal(bytes.length, w, 'the shortest form for ' + n);
  }
});

test('ebmlId: ids keep their marker bits; bad or reserved ids throw', () => {
  assert.equal(hex(W.ebmlId(0xec)), 'ec');
  assert.equal(hex(W.ebmlId(0x4286)), '4286');
  assert.equal(hex(W.ebmlId(0x2ad7b1)), '2ad7b1');
  assert.equal(hex(W.ebmlId(0x1a45dfa3)), '1a45dfa3');
  for (const bad of [0, 0x7f, 0x100, 0x3fff, 0xff, 0x7fff, 0x3fffff, 0x1fffffff, 0x20000000, 1.5, -1, NaN]) {
    throwsCode(() => W.ebmlId(bad), 'args', 'id ' + bad);
  }
  const want = {};
  for (const [id, name] of Object.entries(NAMES)) want[name] = Number(id);
  assert.deepEqual(Object.assign({}, W.IDS), want, 'IDS is exactly the element table of §13.5');
  for (const id of Object.values(W.IDS)) {
    const bytes = W.ebmlId(id);
    const back = readVint(bytes, 0, true);
    assert.equal(back.value, id);
    assert.equal(back.len, bytes.length);
  }
});

// --- the file -------------------------------------------------------------------------------------------------------

test('EBML header: the exact bytes of §13.5 (webm, DocTypeVersion 4, DocTypeReadVersion 2)', async () => {
  const { bytes } = await writeFile(OPTS, makeFrames(3, 30));
  const want = '1a45dfa3' + '9f' + '4286810142f7810142f2810442f38108' + '4282847765626d' + '42878104' + '42858102';
  assert.equal(hex(bytes.subarray(0, want.length / 2)), want);
  const ebml = parse(bytes)[0];
  assert.deepEqual(ebml.children.map((c) => [c.name, c.name === 'DocType' ? txt(c.data) : u(c.data)]), [
    ['EBMLVersion', 1], ['EBMLReadVersion', 1], ['EBMLMaxIDLength', 4], ['EBMLMaxSizeLength', 8], ['DocType', 'webm'],
    ['DocTypeVersion', 4], ['DocTypeReadVersion', 2],
  ]);
});

test('element tree of a transparent VP9 file: SeekHead + Void, Info, Tracks, one Cluster per key frame, Cues', async () => {
  const frames = makeFrames(130, 30);                        // key frames at 0, 60 and 120
  const { bytes, result } = await writeFile(OPTS, frames);
  const { top, seg } = readFile(bytes);
  const group = 'BlockGroup[Block,BlockAdditions[BlockMore[BlockAddID,BlockAdditional]]]';
  const delta = 'BlockGroup[Block,BlockAdditions[BlockMore[BlockAddID,BlockAdditional]],ReferenceBlock]';
  const cluster = (n) => 'Cluster[Timestamp,' + [group].concat(Array(n - 1).fill(delta)).join(',') + ']';
  const cue = 'CuePoint[CueTime,CueTrackPositions[CueTrack,CueClusterPosition]]';
  assert.equal(shape(top), 'EBML[EBMLVersion,EBMLReadVersion,EBMLMaxIDLength,EBMLMaxSizeLength,DocType,DocTypeVersion,' +
    'DocTypeReadVersion],Segment[SeekHead[Seek[SeekID,SeekPosition],Seek[SeekID,SeekPosition],Seek[SeekID,SeekPosition]],Void,' +
    'Info[TimestampScale,Duration,MuxingApp,WritingApp],' +
    'Tracks[TrackEntry[TrackNumber,TrackUID,TrackType,FlagLacing,CodecID,DefaultDuration,MaxBlockAdditionID,' +
    'BlockAdditionMapping[BlockAddIDValue,BlockAddIDType],Video[PixelWidth,PixelHeight,AlphaMode]]],' +
    cluster(60) + ',' + cluster(60) + ',' + cluster(10) + ',Cues[' + [cue, cue, cue].join(',') + ']]');
  assert.deepEqual(result, { bytes: bytes.length, frames: 130, packets: 0, clusters: 3, cues: 3, duration: 4.333333 });

  // Segment: an 8-byte size field, patched to the real size of its data.
  assert.equal(seg.sizeLen, 8);
  assert.equal(bytes[seg.at + 4], 0x01, 'the 8-byte length marker');
  assert.equal(seg.size, bytes.length - seg.dataAt);
  // SeekHead + Void fill 96 bytes; each Seek points at its element (positions from the Segment's data start).
  const head = kid(seg, 'SeekHead');
  const pad = kid(seg, 'Void');
  assert.equal(head.at, seg.dataAt);
  assert.equal(pad.end - head.at, 96);
  assert.ok(pad.data.every((b) => b === 0));
  const seeks = kids(head, 'Seek').map((sk) => [u(kid(sk, 'SeekID').data), val(sk, 'SeekPosition')]);
  assert.deepEqual(seeks.map(([id]) => NAMES[id]), ['Info', 'Tracks', 'Cues']);
  for (const [id, pos] of seeks) assert.equal(kid(seg, NAMES[id]).at, seg.dataAt + pos, NAMES[id] + ' position');
  // Info
  const info = kid(seg, 'Info');
  assert.equal(val(info, 'TimestampScale'), 1000000);
  assert.equal(kid(info, 'Duration').data.length, 8, 'Duration is a 64-bit float');
  assert.equal(val(info, 'Duration', f), 4333.333, 'ms: the last frame\'s ts(129) + 1/30 s, to the µs');
  assert.equal(val(info, 'MuxingApp', txt), 'mojipv 2.1');
  assert.equal(val(info, 'WritingApp', txt), 'mojipv 2.1');
  // Track 1
  const entry = kid(kid(seg, 'Tracks'), 'TrackEntry');
  assert.deepEqual([val(entry, 'TrackNumber'), val(entry, 'TrackUID'), val(entry, 'TrackType'), val(entry, 'FlagLacing')], [1, 1, 1, 0]);
  assert.equal(val(entry, 'CodecID', txt), 'V_VP9');
  assert.equal(val(entry, 'DefaultDuration'), 33333333, 'round(1e9 / 30) ns');
  assert.equal(val(entry, 'MaxBlockAdditionID'), 1);
  const map = kid(entry, 'BlockAdditionMapping');
  assert.deepEqual([val(map, 'BlockAddIDValue'), val(map, 'BlockAddIDType')], [1, 0]);
  const video = kid(entry, 'Video');
  assert.deepEqual([val(video, 'PixelWidth'), val(video, 'PixelHeight'), val(video, 'AlphaMode')], [64, 36, 1]);
});

test('blocks: cluster timestamps at key frames, times round(ts / 1000) ms, alpha BlockAdditional, ReferenceBlock on delta frames', async () => {
  const frames = makeFrames(130, 30);
  const { bytes } = await writeFile(OPTS, frames);
  const { rows, clusters } = readFile(bytes);
  assert.deepEqual(clusters.map((c) => c.ms), [0, 2000, 4000]);
  assert.equal(rows.length, frames.length);
  let prev = null;
  rows.forEach((r, i) => {
    const fr = frames[i];
    const ms = Math.round(fr.ts / 1000);
    assert.equal(r.track, 1);
    assert.equal(r.ms, ms, 'frame ' + i + ' time');
    assert.equal(r.rel, ms - clusters[r.cluster].ms);
    assert.equal(r.key, fr.key, 'frame ' + i + ' key');
    assert.equal(r.simple, false);
    assert.deepEqual(bytes.subarray(r.off, r.off + r.size), fr.colour, 'colour frame ' + i);
    assert.deepEqual(bytes.subarray(r.aoff, r.aoff + r.asize), fr.alpha, 'alpha frame ' + i);
    assert.equal(r.ref, fr.key ? null : prev - ms, 'ReferenceBlock = previous frame − this frame (ms)');
    if (fr.key) assert.equal(clusters[r.cluster].ms, ms, 'a key frame starts its cluster');
    prev = ms;
  });
  assert.deepEqual(rows.filter((r) => !r.key).map((r) => r.ref).filter((v, i, a) => a.indexOf(v) === i).sort(), [-33, -34]);
});

test('cues: one CuePoint per key frame, pointing at the cluster that starts with it', async () => {
  const frames = makeFrames(200, 24, { keyEvery: 48 });
  frames[30].key = true;                                     // a spontaneous extra key frame starts a cluster too
  const { bytes } = await writeFile(Object.assign({}, OPTS, { fps: 24 }), frames);
  const { seg, rows, clusters } = readFile(bytes);
  const points = kids(kid(seg, 'Cues'), 'CuePoint').map((p) => {
    const tp = kid(p, 'CueTrackPositions');
    return { ms: val(p, 'CueTime'), track: val(tp, 'CueTrack'), pos: val(tp, 'CueClusterPosition') };
  });
  const keys = rows.filter((r) => r.key);
  assert.deepEqual(keys.map((r) => r.ms), [0, 1250, 2000, 4000, 6000, 8000]);
  assert.deepEqual(points, keys.map((r) => ({ ms: r.ms, track: 1, pos: clusters[r.cluster].pos })));
  for (const p of points) {
    const cl = parse(bytes, seg.dataAt + p.pos, seg.end)[0];
    assert.equal(cl.name, 'Cluster', 'the cue points at a Cluster element');
    assert.equal(val(cl, 'Timestamp'), p.ms);
  }
  assert.equal(clusters.length, points.length, 'with key frames every 2 s, every cluster has its cue');
});

test('audio: TrackEntry 2 (A_OPUS, OpusHead, CodecDelay, SeekPreRoll) and SimpleBlocks in the cluster of their time', async () => {
  const opts = Object.assign({}, OPTS, { audio: { rate: 48000, channels: 2 } });
  const frames = makeFrames(95, 30);
  const packets = makePackets(S.ts(95, 30));
  const { bytes, result } = await writeFile(opts, frames, packets);
  const { seg, rows, clusters } = readFile(bytes);
  const entries = kids(kid(seg, 'Tracks'), 'TrackEntry');
  assert.equal(entries.length, 2);
  const a = entries[1];
  assert.equal(shape([a]), 'TrackEntry[TrackNumber,TrackUID,TrackType,FlagLacing,CodecID,CodecPrivate,CodecDelay,SeekPreRoll,' +
    'Audio[SamplingFrequency,Channels]]');
  assert.deepEqual([val(a, 'TrackNumber'), val(a, 'TrackUID'), val(a, 'TrackType'), val(a, 'FlagLacing')], [2, 2, 2, 0]);
  assert.equal(val(a, 'CodecID', txt), 'A_OPUS');
  // OpusHead: magic, version 1, 2 channels, pre-skip 312 (LE), 48000 (LE), gain 0, mapping family 0.
  assert.equal(hex(kid(a, 'CodecPrivate').data), '4f707573486561640102380180bb0000000000');
  assert.equal(val(a, 'CodecDelay'), 6500000, '312 samples at 48 kHz in ns');
  assert.equal(val(a, 'SeekPreRoll'), 80000000);
  const au = kid(a, 'Audio');
  assert.equal(kid(au, 'SamplingFrequency').data.length, 8);
  assert.equal(val(au, 'SamplingFrequency', f), 48000);
  assert.equal(val(au, 'Channels'), 2);

  assert.equal(result.packets, packets.length);
  const got = rows.filter((r) => r.track === 2);
  assert.equal(got.length, packets.length);
  got.forEach((r, k) => {
    assert.equal(r.simple, true);
    assert.equal(r.key, true, 'audio blocks are key frames');
    assert.equal(r.ms, Math.round(packets[k].ts / 1000));
    assert.deepEqual(bytes.subarray(r.off, r.off + r.size), packets[k].data);
    const c = clusters[r.cluster];
    const next = clusters[r.cluster + 1];
    assert.ok(r.ms >= c.ms && (!next || r.ms < next.ms), 'packet ' + k + ' is in the cluster of its time');
  });
  // Within each cluster, blocks are in time order, video before audio at equal times.
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].cluster !== rows[i - 1].cluster) continue;
    assert.ok(rows[i].ms > rows[i - 1].ms || (rows[i].ms === rows[i - 1].ms && rows[i].track >= rows[i - 1].track), 'order at ' + i);
  }
  // The Duration covers the longer track: here the video (the last packet starts before the end of the last frame).
  assert.equal(val(kid(seg, 'Info'), 'Duration', f), Math.round(S.ts(94, 30) + 1e6 / 30) / 1000);
});

test('audio: the encoder\'s OpusHead is stored as given and its pre-skip sets CodecDelay; bad heads are refused', async () => {
  const head = Uint8Array.from([...Buffer.from('OpusHead'), 1, 2, 0x00, 0x0f, 0x44, 0xac, 0, 0, 0, 0, 0]);   // pre-skip 3840
  const opts = Object.assign({}, OPTS, { audio: { rate: 48000, channels: 2, codecPrivate: head.buffer } });
  const { bytes } = await writeFile(opts, makeFrames(2, 30), makePackets(40000));
  const a = kids(kid(readFile(bytes).seg, 'Tracks'), 'TrackEntry')[1];
  assert.deepEqual(kid(a, 'CodecPrivate').data, head);
  assert.equal(val(a, 'CodecDelay'), 80000000, '3840 samples = 80 ms');
  const make = (audio) => () => W.createWebm(Object.assign({}, OPTS, { write() {}, audio }));
  throwsCode(make({ rate: 48000, channels: 2, codecPrivate: new Uint8Array(19) }), 'args', 'no OpusHead magic');
  throwsCode(make({ rate: 48000, channels: 2, codecPrivate: head.subarray(0, 18) }), 'args', 'too short');
  throwsCode(make({ rate: 48000, channels: 1, codecPrivate: head }), 'args', 'channel count differs');
  throwsCode(make({ rate: 48000, channels: 6 }), 'args', 'mapping family 0 is 1 or 2 channels');
  throwsCode(make({ rate: 0, channels: 2 }), 'args');
  throwsCode(make({ rate: 48000, channels: 0 }), 'args');
  const mono = kids(kid(readFile((await writeFile(Object.assign({}, OPTS, { audio: { rate: 48000, channels: 1 } }),
    makeFrames(1, 30))).bytes).seg, 'Tracks'), 'TrackEntry')[1];
  assert.equal(hex(kid(mono, 'CodecPrivate').data), '4f707573486561640101380180bb0000000000');
  assert.equal(val(kid(mono, 'Audio'), 'Channels'), 1);
});

test('without alpha: SimpleBlocks with the key flag, and no alpha elements in the track', async () => {
  const opts = Object.assign({}, OPTS, { video: { codec: 'V_VP8', alpha: false } });
  const frames = makeFrames(70, 30, { alpha: false });
  const { bytes } = await writeFile(opts, frames);
  const { seg, rows } = readFile(bytes);
  const entry = kid(kid(seg, 'Tracks'), 'TrackEntry');
  assert.equal(shape([entry]), 'TrackEntry[TrackNumber,TrackUID,TrackType,FlagLacing,CodecID,DefaultDuration,Video[PixelWidth,PixelHeight]]');
  assert.equal(val(entry, 'CodecID', txt), 'V_VP8');
  assert.ok(rows.every((r) => r.simple));
  assert.deepEqual(rows.map((r) => r.key), frames.map((fr) => fr.key));
  rows.forEach((r, i) => assert.deepEqual(bytes.subarray(r.off, r.off + r.size), frames[i].colour));
  const w = W.createWebm(Object.assign({}, opts, { write() {} }));
  throwsCode(() => w.video(payload(1, 0, 4), payload(2, 0, 4), true, 0), 'args', 'an alpha frame needs an alpha track');
});

test('with alpha, a frame without its alpha payload is a BlockGroup without BlockAdditions', async () => {
  const frames = makeFrames(4, 30);
  frames[2].alpha = null;
  const { bytes } = await writeFile(OPTS, frames);
  const { rows } = readFile(bytes);
  assert.deepEqual(rows.map((r) => r.asize), [5, 6, null, 5]);
  assert.deepEqual(rows.map((r) => r.simple), [false, false, false, false]);
});

test('a GOP longer than 32.767 s is split into clusters whose relative times fit an int16; only the key frame gets a cue', async () => {
  const frames = makeFrames(1500, 30, { keyEvery: 1e9, size: () => 3 });   // 50 s, one key frame
  const opts = Object.assign({}, OPTS, { audio: { rate: 48000, channels: 2 } });
  const packets = makePackets(S.ts(1500, 30), 500000);
  const { bytes } = await writeFile(opts, frames, packets);
  const { seg, rows, clusters } = readFile(bytes);
  assert.ok(clusters.length === 2, 'two clusters: ' + clusters.map((c) => c.ms));
  assert.ok(rows.every((r) => r.rel >= 0 && r.rel <= 32767));
  assert.equal(clusters[1].ms, rows.find((r) => r.ms - clusters[0].ms > 32767).ms, 'the split is at the first block past 32.767 s');
  assert.equal(kids(kid(seg, 'Cues'), 'CuePoint').length, 1);
  const video = rows.filter((r) => r.track === 1);
  video.forEach((r, i) => { if (i) assert.equal(r.ref, video[i - 1].ms - r.ms, 'references across the split'); });
});

test('round trip over random inputs: the table, key flags, alpha ranges, codec and cues equal what was written', async () => {
  const r = rng.fromSeed(2101);
  const rates = [24, 25, 30, 30000 / 1001, 60];
  for (let file = 0; file < 40; file++) {
    const fps = rates[Math.floor(r.next() * rates.length)];
    const n = 1 + Math.floor(r.next() * 240);
    const alpha = r.next() < 0.7;
    const codec = r.next() < 0.8 ? 'V_VP9' : 'V_VP8';
    const withAudio = r.next() < 0.5;
    const frames = [];
    for (let i = 0; i < n; i++) {
      const big = r.next() < 0.03;
      const size = big ? 16000 + Math.floor(r.next() * 9000) : 1 + Math.floor(r.next() * 300);
      frames.push({ ts: S.ts(i, fps), key: i === 0 || i % Math.round(2 * fps) === 0 || r.next() < 0.02,
        colour: payload(file, i, size), alpha: alpha && r.next() < 0.97 ? payload(file + 100, i, 1 + Math.floor(r.next() * 200)) : null });
    }
    const packets = withAudio ? makePackets(S.ts(n, fps) + Math.floor(r.next() * 60000), 20000) : [];
    const w = 16 * (1 + Math.floor(r.next() * 120)), h = 2 * (1 + Math.floor(r.next() * 540));
    const opts = { w, h, fps, video: { codec, alpha }, audio: withAudio ? { rate: 48000, channels: 2 } : null };
    const { bytes, result } = await writeFile(opts, frames, packets);
    const { seg, rows, clusters } = readFile(bytes);
    const label = 'file ' + file + ' (' + [fps, n, codec, alpha, withAudio].join(' ') + ')';

    assert.equal(seg.size, bytes.length - seg.dataAt, label);
    const entry = kids(kid(seg, 'Tracks'), 'TrackEntry')[0];
    assert.equal(val(entry, 'CodecID', txt), codec, label);
    assert.equal(val(entry, 'DefaultDuration'), Math.round(1e9 / fps), label);
    assert.deepEqual([val(kid(entry, 'Video'), 'PixelWidth'), val(kid(entry, 'Video'), 'PixelHeight')], [w, h], label);
    assert.equal(kids(kid(entry, 'Video'), 'AlphaMode').length, alpha ? 1 : 0, label);

    const video = rows.filter((x) => x.track === 1);
    assert.deepEqual(video.map((x) => ({ ms: x.ms, key: x.key })), frames.map((fr) => ({ ms: Math.round(fr.ts / 1000), key: fr.key })), label);
    video.forEach((x, i) => {
      assert.deepEqual(bytes.subarray(x.off, x.off + x.size), frames[i].colour, label + ' colour ' + i);
      if (frames[i].alpha) assert.deepEqual(bytes.subarray(x.aoff, x.aoff + x.asize), frames[i].alpha, label + ' alpha ' + i);
      else assert.equal(x.aoff, null, label + ' no alpha ' + i);
      assert.equal(x.simple, !alpha, label);
    });
    const audio = rows.filter((x) => x.track === 2);
    assert.deepEqual(audio.map((x) => x.ms), packets.map((p) => Math.round(p.ts / 1000)), label);
    audio.forEach((x, k) => assert.deepEqual(bytes.subarray(x.off, x.off + x.size), packets[k].data, label + ' packet ' + k));

    for (let i = 0; i < clusters.length; i++) {
      if (i) assert.ok(clusters[i].ms > clusters[i - 1].ms, label + ' cluster order');
    }
    assert.ok(rows.every((x) => x.rel >= 0 && x.rel <= 32767), label);
    const keyRows = video.filter((x) => x.key);
    assert.equal(clusters.length, keyRows.length, label + ': one cluster per key frame (GOPs < 32.7 s)');
    const cues = kids(kid(seg, 'Cues'), 'CuePoint').map((p) => [val(p, 'CueTime'), val(kid(p, 'CueTrackPositions'), 'CueClusterPosition')]);
    assert.deepEqual(cues, keyRows.map((x) => [x.ms, clusters[x.cluster].pos]), label + ' cues');
    const lastEnd = Math.max(frames[n - 1].ts + 1e6 / fps, packets.length ? packets[packets.length - 1].ts : 0);
    assert.equal(val(kid(seg, 'Info'), 'Duration', f), Math.round(lastEnd) / 1000, label + ' Duration');
    assert.deepEqual(result, { bytes: bytes.length, frames: n, packets: packets.length, clusters: clusters.length, cues: cues.length,
      duration: Math.round(lastEnd) / 1e6 }, label);
  }
});

test('determinism: identical bytes for identical tracks, however the video() and audio() calls interleave', async () => {
  const opts = Object.assign({}, OPTS, { audio: { rate: 48000, channels: 2 } });
  const frames = makeFrames(150, 30);
  const packets = makePackets(S.ts(150, 30));
  const base = await writeFile(opts, frames, packets, 'mixed');
  const again = await writeFile(opts, frames, packets, 'mixed');
  assert.deepEqual(again.bytes, base.bytes, 'the same calls twice');
  assert.deepEqual((await writeFile(opts, frames, packets, 'video-first')).bytes, base.bytes, 'all video first');
  assert.deepEqual((await writeFile(opts, frames, packets, 'audio-first')).bytes, base.bytes, 'all audio first');
  const r = rng.fromSeed(99);
  for (let k = 0; k < 10; k++) {
    const seq = frames.map(() => 'v').concat(packets.map(() => 'a'));
    const order = [];
    let i = 0, j = 0;
    while (i < frames.length || j < packets.length) {
      if (j >= packets.length || (i < frames.length && r.next() < 0.5)) { order.push('v'); i++; } else { order.push('a'); j++; }
    }
    assert.equal(order.length, seq.length);
    assert.deepEqual((await writeFile(opts, frames, packets, order)).bytes, base.bytes, 'random interleaving ' + k);
  }
});

test('streaming: appends in order, then exactly three positional patches (Segment size, Duration, SeekHead)', async () => {
  const opts = Object.assign({}, OPTS, { audio: { rate: 48000, channels: 2 } });
  const frames = makeFrames(200, 30);
  const packets = makePackets(S.ts(200, 30));
  const { bytes, calls } = await writeFile(opts, frames, packets);
  const appends = calls.filter((c) => c.position === undefined);
  const patches = calls.filter((c) => c.position !== undefined);
  assert.deepEqual(calls.slice(0, appends.length), appends, 'every append comes before the patches');
  assert.equal(appends.length, 1 + 4 + 1, 'the header, one write per cluster, the Cues');
  const { seg } = readFile(bytes);
  const info = kid(seg, 'Info');
  assert.deepEqual(patches.map((c) => [c.position, c.n]), [[seg.at + 4, 8], [kid(info, 'Duration').dataAt, 8], [seg.dataAt, 96]]);

  // Before finish(): the Segment has the unknown size, and what was written so far parses.
  const sink = collector();
  const w = W.createWebm(Object.assign({}, opts, { write: sink.write }));
  frames.slice(0, 70).forEach((fr) => w.video(fr.colour, fr.alpha, fr.key, fr.ts));
  packets.slice(0, 120).forEach((p) => w.audio(p.data, p.ts));
  await new Promise((resolve) => setImmediate(resolve));
  const early = sink.bytes;
  assert.equal(hex(early.subarray(seg.at + 4, seg.at + 12)), '01ffffffffffffff', 'unknown size until finish()');
  const partial = parse(early);
  assert.equal(partial[1].size, null);
  assert.deepEqual(partial[1].children.map((c) => c.name), ['SeekHead', 'Void', 'Info', 'Tracks', 'Cluster'],
    'the first cluster is written once the next key frame and the audio up to it have arrived');
  assert.equal(kids(kid(partial[1], 'SeekHead'), 'Seek').length, 2, 'no Cues entry yet');
});

test('the export sinks: a memory sink (positional patches) holds the same file', async () => {
  const opts = Object.assign({}, OPTS, { audio: { rate: 48000, channels: 2 } });
  const frames = makeFrames(90, 30);
  const packets = makePackets(S.ts(90, 30));
  const want = (await writeFile(opts, frames, packets)).bytes;
  const sink = SINK.createMemorySink({ type: 'video/webm' });
  const w = W.createWebm(Object.assign({}, opts, { write: (b, p) => sink.write(b, p) }));
  for (let i = 0, j = 0; i < frames.length || j < packets.length;) {
    if (j >= packets.length || (i < frames.length && frames[i].ts <= packets[j].ts)) {
      const fr = frames[i++];
      await w.video(fr.colour, fr.alpha, fr.key, fr.ts);
    } else {
      const p = packets[j++];
      await w.audio(p.data, p.ts);
    }
  }
  await w.finish();
  const { blob, bytes } = await sink.close();
  assert.equal(bytes, want.length);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), want);
});

test('encoded chunks (copyTo, byteLength, duration) are accepted; the Duration then ends exactly at ts(N)', async () => {
  const chunk = (bytes, duration) => ({ byteLength: bytes.length, duration, type: 'key', copyTo: (dst) => dst.set(bytes) });
  const fps = 30, n = 45;
  const frames = makeFrames(n, fps);
  const sink = collector();
  const w = W.createWebm(Object.assign({}, OPTS, { write: sink.write }));
  frames.forEach((fr, i) => w.video(chunk(fr.colour, S.frameDur(i, fps)), chunk(fr.alpha, S.frameDur(i, fps)), fr.key, fr.ts));
  const res = await w.finish();
  assert.equal(res.duration, S.ts(n, fps) / 1e6);
  const { seg, rows } = readFile(sink.bytes);
  assert.equal(val(kid(seg, 'Info'), 'Duration', f), S.ts(n, fps) / 1000);
  rows.forEach((r, i) => assert.deepEqual(sink.bytes.subarray(r.off, r.off + r.size), frames[i].colour));

  // A chunk's own duration is the one that counts: a longer last frame, then an audio packet that ends later still.
  async function durationOf(withAudio) {
    const sk = collector();
    const wr = W.createWebm(Object.assign({}, OPTS, { write: sk.write, audio: withAudio ? { rate: 48000, channels: 2 } : null }));
    wr.video(chunk(frames[0].colour, 40000), null, true, 0);
    wr.video(chunk(frames[1].colour, 45000), null, false, 40000);
    if (withAudio) {
      wr.audio(chunk(payload(3, 0, 5), 20000), 0);
      wr.audio(chunk(payload(3, 1, 5), 20000), 80000);
    }
    const res = await wr.finish();
    assert.equal(val(kid(readFile(sk.bytes).seg, 'Info'), 'Duration', f), res.duration * 1000, 'Info Duration in ms');
    return res.duration;
  }
  assert.equal(await durationOf(false), 0.085, 'the last frame ends at 40 + 45 ms');
  assert.equal(await durationOf(true), 0.1, 'the last packet ends at 80 + 20 ms');

  // Buffers passed in are copied: changing them after the call changes nothing.
  const reuse = new Uint8Array([1, 2, 3, 4]);
  const s2 = collector();
  const w2 = W.createWebm(Object.assign({}, OPTS, { write: s2.write }));
  w2.video(reuse, reuse.subarray(0, 2), true, 0);
  reuse.fill(9);
  await w2.finish();
  const row = readFile(s2.bytes).rows[0];
  assert.deepEqual(Array.from(s2.bytes.subarray(row.off, row.off + row.size)), [1, 2, 3, 4]);
  assert.deepEqual(Array.from(s2.bytes.subarray(row.aoff, row.aoff + row.asize)), [1, 2]);
});

test('empty and audio-only files are valid: no Cues, and no Cues entry in the SeekHead', async () => {
  const empty = await writeFile(OPTS, []);
  const e = readFile(empty.bytes);
  assert.deepEqual(e.seg.children.map((c) => c.name), ['SeekHead', 'Void', 'Info', 'Tracks']);
  assert.equal(val(kid(e.seg, 'Info'), 'Duration', f), 0);
  assert.equal(kids(kid(e.seg, 'SeekHead'), 'Seek').length, 2);
  assert.equal(e.seg.size, empty.bytes.length - e.seg.dataAt);

  const opts = Object.assign({}, OPTS, { audio: { rate: 48000, channels: 2 } });
  const packets = makePackets(40000000, 20000);                    // 40 s of packets, no video
  const only = await writeFile(opts, [], packets);
  const o = readFile(only.bytes);
  assert.equal(kids(o.seg, 'Cues').length, 0);
  assert.equal(o.rows.length, packets.length);
  assert.ok(o.clusters.length === 2 && o.rows.every((r) => r.rel <= 32767));
});

test('errors: arguments, order, after finish, and a failed write', async () => {
  const base = Object.assign({}, OPTS, { write() {} });
  const make = (patch) => () => W.createWebm(Object.assign({}, base, patch));
  throwsCode(make({ write: null }), 'args');
  throwsCode(make({ w: 0 }), 'args');
  throwsCode(make({ h: 1.5 }), 'args');
  throwsCode(make({ fps: 0 }), 'args');
  throwsCode(make({ fps: NaN }), 'args');
  throwsCode(make({ video: { codec: 'V_AV1', alpha: true } }), 'args');
  throwsCode(make({ video: null }), 'args');
  assert.doesNotThrow(make({ fps: 30000 / 1001 }), 'fractional rates are fine');

  const w = W.createWebm(base);
  throwsCode(() => w.video(payload(1, 0, 4), null, false, 0), 'order', 'the first frame must be a key frame');
  throwsCode(() => w.video(new Uint8Array(0), null, true, 0), 'args', 'empty frame');
  throwsCode(() => w.video('abc', null, true, 0), 'args', 'not bytes');
  throwsCode(() => w.video(payload(1, 0, 4), null, true, -1), 'args', 'negative time');
  throwsCode(() => w.video(payload(1, 0, 4), null, true, NaN), 'args');
  w.video(payload(1, 0, 4), null, true, 33333);
  throwsCode(() => w.video(payload(1, 1, 4), null, false, 33333), 'order', 'same time');
  throwsCode(() => w.video(payload(1, 1, 4), null, false, 33400), 'order', 'same millisecond (33.4 ms rounds to 33)');
  throwsCode(() => w.video(payload(1, 1, 4), null, false, 1000), 'order', 'earlier');
  throwsCode(() => w.audio(payload(3, 0, 4), 0), 'args', 'no audio track');
  await w.finish();
  throwsCode(() => w.video(payload(1, 2, 4), null, false, 99999), 'finished');
  await assert.rejects(w.finish(), (e) => e.code === 'finished');

  const wa = W.createWebm(Object.assign({}, base, { audio: { rate: 48000, channels: 2 } }));
  wa.audio(payload(3, 0, 4), 20000);
  throwsCode(() => wa.audio(payload(3, 1, 4), 20000), 'order');
  throwsCode(() => wa.audio(payload(3, 1, 4), 0), 'order');

  // A failing sink: the returned promises still resolve; the next call throws 'sink' and finish() rejects.
  let n = 0;
  const failing = W.createWebm(Object.assign({}, base, { write: () => { if (++n === 2) throw new Error('disk full'); } }));
  const p1 = failing.video(payload(1, 0, 4), payload(2, 0, 2), true, 0);
  const p2 = failing.video(payload(1, 1, 4), payload(2, 1, 2), true, 2000000);   // closes the first cluster: write 2 fails
  assert.ok(p1 instanceof Promise && p2 instanceof Promise);
  await p2;
  throwsCode(() => failing.video(payload(1, 2, 4), payload(2, 2, 2), false, 2033333), 'sink');
  await assert.rejects(failing.finish(), (e) => e.code === 'sink' && /disk full/.test(e.message));
});

test('an asynchronous sink: writes are queued in order and the file equals a synchronous one', async () => {
  const opts = Object.assign({}, OPTS, { audio: { rate: 48000, channels: 2 } });
  const frames = makeFrames(130, 30);
  const packets = makePackets(S.ts(130, 30));
  const want = (await writeFile(opts, frames, packets)).bytes;
  const sink = collector();
  let busy = false;
  const slow = async (b, p) => {
    assert.equal(busy, false, 'one write at a time');
    busy = true;
    await new Promise((resolve) => setImmediate(resolve));
    sink.write(b, p);
    busy = false;
  };
  const w = W.createWebm(Object.assign({}, opts, { write: slow }));
  const pending = [];
  for (let i = 0, j = 0; i < frames.length || j < packets.length;) {
    if (j >= packets.length || (i < frames.length && frames[i].ts <= packets[j].ts)) {
      const fr = frames[i++];
      pending.push(w.video(fr.colour, fr.alpha, fr.key, fr.ts));
    } else {
      const p = packets[j++];
      pending.push(w.audio(p.data, p.ts));
    }
  }
  await Promise.all(pending);
  await w.finish();
  assert.deepEqual(sink.bytes, want);
});
