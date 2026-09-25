/* 文字PVメーカー v2 — original work. Tests for media/sniff, media/isobmff and media/matroska (DESIGN_2_1 §11.8.2 media_demux.test.js). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { load } = require('../helpers/load.js');
const GEN = require('../helpers/make_media_fixtures.js');

const MV = load();
const SN = MV.use('media/sniff');
const ISO = MV.use('media/isobmff');
const MKV = MV.use('media/matroska');
const SM = MV.use('media/samples');

const DIR = path.resolve(__dirname, '..', 'fixtures', 'media');
const committed = (name) => new Uint8Array(fs.readFileSync(path.join(DIR, name)));
const MAKE = GEN.parseMake(fs.readFileSync(path.join(DIR, 'MAKE.txt'), 'utf8'));
const H = GEN.helpers;

// A read() over bytes that records every range it serves.
function reader(bytes) {
  const log = [];
  const read = async (at, n) => { log.push([at, Math.min(n, bytes.length - at)]); return bytes.subarray(at, at + n); };
  return { read, log, total: () => log.reduce((s, [, n]) => s + n, 0) };
}

function demuxerFor(bytes) {
  const s = SN.sniff(bytes);
  return s.container === 'webm' || s.container === 'matroska' ? MKV : ISO;
}

async function parseBytes(bytes) { return demuxerFor(bytes).parse(reader(bytes).read, bytes.length); }

// --- the committed fixtures ----------------------------------------------------------------------------------------------

test('fixtures: the committed files and MAKE.txt are exactly what the generator writes, each < 24 KB', () => {
  const { files, make } = GEN.build();
  assert.deepEqual([...files.keys()].sort(), fs.readdirSync(DIR).filter((f) => f !== 'MAKE.txt').sort());
  for (const [name, bytes] of files) {
    assert.ok(bytes.length < 24 * 1024, name + ' < 24 KB');
    assert.deepEqual(Buffer.from(committed(name)), Buffer.from(bytes), name + ' is unchanged');
  }
  assert.equal(fs.readFileSync(path.join(DIR, 'MAKE.txt'), 'utf8'), make, 'MAKE.txt is unchanged');
});

test('sniff: every committed fixture, including the refusals', () => {
  for (const name of GEN.FIXTURES) {
    const s = SN.sniff(committed(name).subarray(0, SN.HEAD));
    assert.deepEqual([s.kind, s.container, s.mime], MAKE[name].sniff, name);
  }
  const gif = SN.sniff(committed('anim.gif'));
  assert.equal(gif.anim, true);
  assert.deepEqual([gif.w, gif.h], [64, 36]);
});

test('sniff: images with header sizes, audio, SVG, packages and unknown data', () => {
  const b = (...parts) => H.concat(parts);
  const png = (colour, extra) => b([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13], 'IHDR', [0, 0, 1, 0x40, 0, 0, 0, 0xf0, 8, colour, 0, 0, 0],
    [0, 0, 0, 0], extra || [], [0, 0, 0, 0], 'IDAT');
  assert.deepEqual(SN.sniff(png(6)), { kind: 'image', container: 'png', mime: 'image/png', w: 320, h: 240, alphaHint: true, anim: false });
  assert.equal(SN.sniff(png(2)).alphaHint, false);
  assert.equal(SN.sniff(png(2, [0, 0, 0, 8, ...Buffer.from('acTL'), 0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0])).anim, true, 'APNG');
  const jpeg = b([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0], [0xff, 0xc2, 0, 11, 8], [0x0b, 0xb8], [0x0f, 0xa0], [3]);
  assert.deepEqual([SN.sniff(jpeg).kind, SN.sniff(jpeg).w, SN.sniff(jpeg).h], ['image', 4000, 3000]);
  const vp8x = b('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8X', [10, 0, 0, 0], [0x12, 0, 0, 0], [0x3f, 0x01, 0], [0xef, 0, 0]);
  assert.deepEqual([SN.sniff(vp8x).w, SN.sniff(vp8x).h, SN.sniff(vp8x).anim, SN.sniff(vp8x).alphaHint], [320, 240, true, true]);
  const vp8l = b('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8L', [0, 0, 0, 0], [0x2f], [0x3f, 0xc0, 0x3b, 0x10]);
  assert.deepEqual([SN.sniff(vp8l).w, SN.sniff(vp8l).h, SN.sniff(vp8l).alphaHint], [64, 240, true]);
  const lossy = b('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8 ', [0, 0, 0, 0], [0, 0, 0], [0x9d, 0x01, 0x2a], [0x40, 0x01, 0xf0, 0x00]);
  assert.deepEqual([SN.sniff(lossy).w, SN.sniff(lossy).h], [320, 240]);
  const avif = b(H.box('ftyp', 'avif', [0, 0, 0, 0], 'avif', 'mif1', 'miaf'), H.box('meta', [0, 0, 0, 0], H.full('ispe', 0, 0, [0, 0, 7, 0x80, 0, 0, 4, 0x38])));
  assert.deepEqual([SN.sniff(avif).kind, SN.sniff(avif).mime, SN.sniff(avif).w, SN.sniff(avif).h], ['image', 'image/avif', 1920, 1080]);
  assert.equal(SN.sniff(H.box('ftyp', 'mif1', [0, 0, 0, 0], 'mif1', 'heic')).kind, 'heic');
  assert.deepEqual(SN.sniff(H.box('ftyp', 'M4A ', [0, 0, 0, 0], 'M4A ', 'isom')), { kind: 'audio', container: 'mp4', mime: 'audio/mp4' });
  assert.equal(SN.sniff(H.box('ftyp', 'M4V ', [0, 0, 0, 0], 'M4V ')).mime, 'video/x-m4v');
  assert.equal(SN.sniff(b('RIFF', [0, 0, 0, 0], 'WAVE')).kind, 'audio');
  assert.equal(SN.sniff(b('ID3', [3, 0, 0, 0, 0, 0, 0])).mime, 'audio/mpeg');
  assert.equal(SN.sniff(b([0xff, 0xfb, 0x90, 0x64])).mime, 'audio/mpeg');
  assert.equal(SN.sniff(b([0xff, 0xf1, 0x50, 0x80])).mime, 'audio/aac');
  assert.equal(SN.sniff(b('fLaC', [0, 0, 0, 0])).mime, 'audio/flac');
  assert.equal(SN.sniff(b('OggS', [0, 2, 0, 0])).mime, 'audio/ogg');
  assert.equal(SN.sniff(b('<?xml version="1.0"?>\n<!-- x -->\n<svg xmlns="http://www.w3.org/2000/svg">')).kind, 'svg');
  assert.equal(SN.sniff(b('\xef\xbb\xbf<svg width="1">')).kind, 'svg');
  assert.equal(SN.sniff(b('hello, <svg> is only text here but the kind is svg')).kind, 'svg', 'a text file that has <svg is treated as SVG');
  assert.equal(SN.sniff(b('plain text')).kind, 'unknown');
  const pkg = b('PK\x03\x04', [10, 0, 0, 8, 0, 0, 0, 0, 0x21, 0], [0, 0, 0, 0], [26, 0, 0, 0, 26, 0, 0, 0], [8, 0, 0, 0], 'mimetype',
    'application/vnd.mojipv+zip');
  assert.deepEqual(SN.sniff(pkg), { kind: 'package', container: 'zip', mime: 'application/vnd.mojipv+zip' });
  pkg[29] = 1;                                              // an extra field moves the text: not a package
  assert.equal(SN.sniff(pkg).kind, 'zip');
  assert.equal(SN.sniff(b([0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x82, 0x81, 0x78])).kind, 'unknown', 'EBML with another DocType');
  assert.equal(SN.sniff(new Uint8Array(3)).kind, 'unknown');
  assert.equal(SN.sniff(new Uint8Array(100)).kind, 'unknown');
});

test('exif_write (the import tests\' helper): an Orientation APP1 after SOI; the sniffer still reads the SOF size', () => {
  const EXIF = require('../helpers/exif_write.js');
  const jpeg = H.concat([[0xff, 0xd8], [0xff, 0xe0, 0, 16], 'JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0], [0xff, 0xc0, 0, 11, 8, 0, 32, 0, 64, 1, 1, 0x11, 0],
    [0xff, 0xda, 0, 2], [0xff, 0xd9]]);
  assert.equal(EXIF.readOrientation(jpeg), null);
  const six = EXIF.withOrientation(jpeg, 6);
  assert.equal(EXIF.readOrientation(six), 6);
  assert.deepEqual([six[0], six[1], six[2], six[3]], [0xff, 0xd8, 0xff, 0xe1], 'APP1 right after SOI');
  assert.deepEqual([SN.sniff(six).w, SN.sniff(six).h], [64, 32], 'the stored (not the upright) size');
  const three = EXIF.withOrientation(six, 3);
  assert.equal(EXIF.readOrientation(three), 3, 'an existing Exif segment is replaced');
  assert.equal(three.length, six.length);
  assert.throws(() => EXIF.withOrientation(Uint8Array.of(1, 2, 3), 6), /not a JPEG/);
});

// Compares a demuxed track with the MAKE.txt rows of `name`.
function checkAgainstMake(name, movie) {
  const want = MAKE[name];
  const kv = Object.fromEntries(want.video.map((x) => x.split('=')));
  assert.equal(movie.brand, JSON.parse(want.brand.join(' ')), name + ' brand');
  assert.deepEqual(movie.tracks.map((t) => t.kind), want.tracks, name + ' tracks');
  const v = movie.tracks.find((t) => t.kind === 'video');
  assert.equal(v.codec, kv.codec, name + ' codec string');
  for (const k of ['w', 'h', 'codedW', 'codedH', 'rot']) assert.equal(v[k], Number(kv[k]), name + ' ' + k);
  assert.equal(v.alpha, kv.alpha === 'true', name + ' alpha');
  assert.equal(v.description === null ? 'none' : v.description.length > 0 ? kv.description : '?', kv.description, name + ' description');
  if (want.color) {
    const c = Object.fromEntries(want.color.map((x) => x.split('=')));
    assert.deepEqual(v.color, { primaries: +c.primaries, transfer: +c.transfer, matrix: +c.matrix, fullRange: JSON.parse(c.fullRange) }, name + ' color');
  }
  if (want.warning) assert.ok(movie.warnings.includes(want.warning[0]), name + ' warning ' + want.warning[0]);
  const t = v.table;
  assert.equal(t.n, Number(want.n[0]), name + ' n');
  assert.ok(Math.abs(t.duration - Number(want.duration[0])) < 1e-9, name + ' duration');
  for (const k of ['pts', 'dur']) {
    const rows = want['pres.' + k].map(Number);
    assert.equal(t[k].length, rows.length, name + ' ' + k + ' length');
    rows.forEach((x, i) => assert.ok(Math.abs(t[k][i] - x) < 1e-9, name + ' ' + k + '[' + i + '] ' + t[k][i] + ' ≠ ' + x));
  }
  assert.deepEqual(Array.from(t.dec), want['pres.dec'].map(Number), name + ' dec');
  for (const k of ['key', 'off', 'size', 'ts', 'aoff', 'asize']) {
    if (!want['dec.' + k]) { assert.equal(t[k] === undefined ? null : t[k], null, name + ' ' + k + ' absent'); continue; }
    assert.deepEqual(Array.from(t[k]), want['dec.' + k].map(Number), name + ' ' + k);
  }
}

test('isobmff and matroska: every committed video fixture gives the table recorded in MAKE.txt', async () => {
  for (const name of GEN.FIXTURES) {
    if (!MAKE[name].video) continue;
    const bytes = committed(name);
    checkAgainstMake(name, await parseBytes(bytes));
  }
});

test('isobmff: bframes.mp4 — presentation order, the pre-roll frame fed but not shown, runs from the key frame', async () => {
  const t = (await parseBytes(committed('bframes.mp4'))).tracks[0].table;
  assert.equal(t.key.length, 25, 'the decode order keeps the pre-roll sample');
  assert.equal(t.n, 24, 'it is not shown');
  assert.ok(t.ts[0] < 0, 'the pre-roll sample decodes before time 0');
  for (let i = 1; i < t.n; i++) assert.ok(t.pts[i] > t.pts[i - 1], 'pts ascending');
  assert.deepEqual(SM.runFor(t, 0), { from: 0, to: 2 }, 'the first shown frame (a B-frame) needs I0, P3 and itself');
  assert.deepEqual(SM.runFor(t, 12), { from: 10, to: 11 }, 'frame 13 (P) follows I10 in decode order');
  assert.equal(SM.sampleAt(t, 0.5), 12);
});

test('isobmff: rot90.mp4 reads the matrix as 90° with w and h swapped; frag.mp4 reads every fragment', async () => {
  const r = (await parseBytes(committed('rot90.mp4'))).tracks[0];
  assert.deepEqual([r.rot, r.w, r.h, r.codedW, r.codedH], [90, 36, 64, 64, 36]);
  const f = (await parseBytes(committed('frag.mp4'))).tracks[0].table;
  assert.equal(f.n, 25);
  assert.deepEqual(Array.from(f.key).map((k, d) => (k ? d : -1)).filter((d) => d >= 0), [0, 10, 20]);
});

test('reads only headers: no MP4 payload byte is read, and a WebM is read at most once', async () => {
  for (const name of GEN.FIXTURES) {
    if (!MAKE[name].video) continue;
    const bytes = committed(name);
    const r = reader(bytes);
    const movie = await demuxerFor(bytes).parse(r.read, bytes.length);
    const t = movie.tracks.find((x) => x.kind === 'video').table;
    if (demuxerFor(bytes) === ISO) {
      for (const [at, n] of r.log) {
        for (let d = 0; d < t.key.length; d++) {
          const overlap = at < t.off[d] + t.size[d] && t.off[d] < at + n;
          assert.ok(!overlap, name + ': read ' + at + '+' + n + ' touches sample ' + d);
        }
      }
    } else {
      assert.ok(r.total() <= bytes.length + 64, name + ': ' + r.total() + ' bytes read for a ' + bytes.length + '-byte file');
    }
  }
});

test('matroska: the scan reads in windows and reports progress', async () => {
  const bytes = committed('laced.mkv');
  const r = reader(bytes);
  const seen = [];
  await MKV.parse(r.read, bytes.length, { onProgress: (p) => seen.push(p) });
  assert.equal(seen[seen.length - 1], 1);
  assert.ok(r.log.length <= 3, 'a small file is one window (plus the header reads): ' + r.log.length);
});

test('truncated files are MediaError broken; laced video and content encodings are MediaError container', async () => {
  for (const name of GEN.FIXTURES) {
    if (!MAKE[name].video) continue;
    const bytes = committed(name);
    for (const cut of [bytes.length - 1, Math.floor(bytes.length * 0.6), Math.floor(bytes.length / 3), 40, 12]) {
      await assert.rejects(parseBytes(bytes.subarray(0, cut)), (e) => e instanceof SM.MediaError && e.code === 'broken',
        name + ' cut at ' + cut);
    }
  }
  await assert.rejects(ISO.parse(async () => new Uint8Array(0), 100), (e) => e.code === 'broken', 'a read that returns nothing');
  // a laced video block
  const laced = [H.el(H.E.SimpleBlock, [0x81, 0, 0, 0x82, 1, 10], H.payload('x', 0, 20))];
  const bad = H.matroska({ doc: 'webm', tracks: [H.videoTrack({ codec: 'V_VP8', defaultDuration: 40000000 })],
    frames: [{ time: 0, key: true, data: H.vp8Frame(true, 0, 30) }], durationMs: 40, extra: () => laced });
  await assert.rejects(parseBytes(bad.bytes), (e) => e instanceof SM.MediaError && e.code === 'container');
  const encoded = H.matroska({ doc: 'webm', durationMs: 40, frames: [{ time: 0, key: true, data: H.vp8Frame(true, 0, 30) }],
    tracks: [H.el(H.E.TrackEntry, H.eu(H.E.TrackNumber, 1), H.eu(H.E.TrackType, 1), H.es(H.E.CodecID, 'V_VP8'),
      H.el(0x6d80, H.el(0x6240, H.eu(0x5034, 0))), H.el(H.E.Video, H.eu(H.E.PixelWidth, 64), H.eu(H.E.PixelHeight, 36)))] });
  await assert.rejects(parseBytes(encoded.bytes), (e) => e.code === 'container');
  const noDoc = H.concat([H.el(H.E.EBML, H.es(H.E.DocType, 'mkvx')), H.el(H.E.Segment, [])]);
  await assert.rejects(MKV.parse(reader(noDoc).read, noDoc.length), (e) => e.code === 'broken');
});

test('matroska: laced audio blocks are skipped; the last frame takes its BlockDuration', async () => {
  const m = await parseBytes(committed('laced.mkv'));
  assert.deepEqual(m.tracks.map((t) => [t.kind, t.codec]), [['video', 'avc1.42C00A'], ['audio', 'A_OPUS']]);
  const t = m.tracks[0].table;
  assert.equal(t.n, 25);
  assert.ok(Math.abs(t.dur[24] - 0.04) < 1e-12);
  assert.deepEqual(Array.from(m.tracks[0].description), H.avcC(0x42, 0xc0, 0x0a), 'CodecPrivate (avcC) is the description');
});

test('matroska: VP9 profile and bit depth from the key frame header; alpha ranges; AV1 string', async () => {
  for (const [profile, depth] of [[0, 8], [1, 8], [2, 10], [2, 12], [3, 10], [3, 12]]) {
    assert.deepEqual(MKV.vp9Header(H.vp9Key(profile, depth, 0, 32)), { profile, depth }, 'profile ' + profile + ' ' + depth + ' bit');
  }
  assert.equal(MKV.vp9Header(H.payload('xx', 0, 32)), null, 'not a key frame header');
  const frames = Array.from({ length: 30 }, (_, i) => ({ time: Math.round(i * 1000 / 30), key: i === 0, data: i ? H.payload('d', i, 40) : H.vp9Key(2, 10, 0, 40) }));
  const big = H.matroska({ doc: 'webm', durationMs: 1000, frames,
    tracks: [H.videoTrack({ codec: 'V_VP9', w: 1920, h: 1080, defaultDuration: 33333333 })] });
  assert.equal((await parseBytes(big.bytes)).tracks[0].codec, 'vp09.02.40.10', 'profile 2, 10 bit, level 4 for 1080p30');
  const alpha = (await parseBytes(committed('alpha_vp8.webm'))).tracks[0];
  assert.equal(alpha.alpha, true);
  const bytes = committed('alpha_vp8.webm');
  for (let d = 0; d < alpha.table.key.length; d++) {
    const a = bytes.subarray(alpha.table.aoff[d], alpha.table.aoff[d] + alpha.table.asize[d]);
    assert.deepEqual(Buffer.from(a), Buffer.from(H.vp8Frame(d === 0, 100 + d, 20 + ((d * 5) % 11))), 'alpha payload ' + d);
  }
  assert.equal((await parseBytes(committed('av1.webm'))).tracks[0].codec, 'av01.0.00M.08');
});

test('matroska: millisecond block times snap to i · DefaultDuration (no off-by-one at 24, 30, 60 fps); VFR times are kept', async () => {
  for (const fps of [24, 30, 60, 30000 / 1001]) {
    const n = Math.round(fps * 40);                          // 40 s of frames, a cluster every 2 s
    const frames = Array.from({ length: n }, (_, i) => ({ time: Math.round((i * 1000) / fps), key: i % Math.round(2 * fps) === 0,
      data: H.payload('s', i, 12) }));
    const mk = H.matroska({ doc: 'webm', durationMs: Math.round((n * 1000) / fps), frames,
      tracks: [H.videoTrack({ codec: 'V_VP8', defaultDuration: Math.round(1e9 / fps) })] });
    const t = (await parseBytes(mk.bytes)).tracks[0].table;
    for (let k = 0; k < n; k++) {
      if (SM.sampleAt(t, k / fps) !== k) assert.fail(fps + ' fps: sampleAt(' + k + ' / fps) = ' + SM.sampleAt(t, k / fps));
      assert.equal(t.ts[k], Math.round((k * Math.round(1e9 / fps)) / 1000), 'the chunk timestamp follows the snapped time');
    }
    assert.equal(t.vfr, false);
  }
  // without DefaultDuration, or with a gap: the stored times are kept
  const vfrTimes = [0, 33, 67, 100, 133, 167, 200, 267, 333, 400];
  const vfr = H.matroska({ doc: 'webm', durationMs: 450, frames: vfrTimes.map((time, i) => ({ time, key: i === 0, data: H.payload('v', i, 9) })),
    tracks: [H.videoTrack({ codec: 'V_VP8', defaultDuration: 33333333 })] });
  const tv = (await parseBytes(vfr.bytes)).tracks[0].table;
  assert.deepEqual(Array.from(tv.pts), vfrTimes.map((x) => x / 1000), 'a VFR file keeps its times');
  assert.equal(tv.vfr, true);
  const noDefault = H.matroska({ doc: 'webm', durationMs: 100, frames: [0, 33, 67].map((time, i) => ({ time, key: !i, data: H.payload('n', i, 9) })),
    tracks: [H.videoTrack({ codec: 'V_VP8' })] });
  assert.deepEqual(Array.from((await parseBytes(noDefault.bytes)).tracks[0].table.pts), [0, 0.033, 0.067]);
});

// --- the round trip through export/webm (package H.1's writer, §13.5) -----------------------------------------------------

const WEBM = MV.use('export/webm');
const SCHED = MV.use('export/schedule');

// A sink with positional writes (the writer patches the Segment size, Duration and SeekHead at finish()).
function memorySink() {
  let buf = new Uint8Array(0);
  return {
    write: async (bytes, position) => {
      const at = position === undefined ? buf.length : position;
      if (at + bytes.length > buf.length) { const next = new Uint8Array(at + bytes.length); next.set(buf); buf = next; }
      buf.set(bytes, at);
    },
    bytes: () => buf,
  };
}

async function webmOf({ fps, n, alpha, audio, size = (i) => 30 + (i % 7), keyEvery = 2 * fps }) {
  const sink = memorySink();
  const w = WEBM.createWebm({ write: sink.write, w: 64, h: 36, fps, video: { codec: 'V_VP9', alpha }, audio: audio ? { rate: 48000, channels: 2 } : null });
  const frames = [];
  for (let i = 0; i < n; i++) {
    const key = i % keyEvery === 0;
    frames.push({ key, colour: key ? H.vp9Key(0, 8, i, size(i)) : H.payload('c', i, size(i)), alpha: alpha ? H.payload('a', i, 5 + (i % 3)) : null,
      ts: SCHED.ts(i, fps) });
  }
  let p = 0;
  for (const f of frames) {
    while (audio && p * 20000 <= f.ts) { await w.audio(H.payload('o', p, 4 + (p % 3)), p * 20000); p++; }
    await w.video(f.colour, f.alpha, f.key, f.ts);
  }
  const result = await w.finish();
  return { bytes: sink.bytes(), frames, result };
}

test('matroska on export/webm output: table, alpha ranges and codec equal the input (24, 30, 60 fps; alpha and opaque; audio)', async () => {
  for (const fps of [24, 30, 60]) {
    for (const alpha of [true, false]) {
      const n = 5 * fps;
      const { bytes, frames } = await webmOf({ fps, n, alpha, audio: fps === 30 });
      const movie = await parseBytes(bytes);
      const label = fps + ' fps alpha ' + alpha;
      assert.deepEqual(movie.tracks.map((tr) => tr.kind), fps === 30 ? ['video', 'audio'] : ['video'], label + ' tracks');
      const v = movie.tracks[0];
      assert.equal(v.codec, 'vp09.00.' + String(SM.vp9Level(64, 36, fps)).padStart(2, '0') + '.08', label + ' codec');
      assert.equal(v.alpha, alpha, label + ' AlphaMode');
      const t = v.table;
      assert.equal(t.n, n, label + ' n');
      frames.forEach((f, d) => {
        assert.equal(t.key[d], f.key ? 1 : 0, label + ' key ' + d);
        assert.deepEqual(Buffer.from(bytes.subarray(t.off[d], t.off[d] + t.size[d])), Buffer.from(f.colour), label + ' colour ' + d);
        if (alpha) assert.deepEqual(Buffer.from(bytes.subarray(t.aoff[d], t.aoff[d] + t.asize[d])), Buffer.from(f.alpha), label + ' alpha ' + d);
      });
      if (!alpha) assert.equal(t.aoff, null, label + ': no alpha ranges');
      for (let k = 0; k < n; k++) if (SM.sampleAt(t, k / fps) !== k) assert.fail(label + ': sampleAt(' + k + ' / fps) = ' + SM.sampleAt(t, k / fps));
      assert.equal(t.vfr, false);
    }
  }
});

test('matroska on export/webm output: a 9 MB file is scanned in 4 MB windows and read at most once', async () => {
  const { bytes } = await webmOf({ fps: 30, n: 300, alpha: true, size: () => 30000 });
  assert.ok(bytes.length > 2 * MKV.WINDOW);
  const r = reader(bytes);
  const movie = await MKV.parse(r.read, bytes.length);
  assert.equal(movie.tracks[0].table.n, 300);
  assert.ok(r.total() <= bytes.length + 1024, r.total() + ' bytes read for ' + bytes.length);
  assert.ok(r.log.length <= Math.ceil(bytes.length / MKV.WINDOW) + 4, r.log.length + ' reads');
});

test('matroska: tracksOnly stops after Tracks (the router asks whether there is a video track)', async () => {
  const bytes = committed('laced.mkv');
  const r = reader(bytes);
  const m = await MKV.parse(r.read, bytes.length, { tracksOnly: true });
  assert.deepEqual(m.tracks.map((t) => [t.kind, t.codec, t.table]), [['video', 'avc1', null], ['audio', 'A_OPUS', null]]);
});

// --- synthetic files from the vendored mp4-muxer ----------------------------------------------------------------------------

vm.runInThisContext(fs.readFileSync(path.resolve(__dirname, '..', '..', 'vendor', 'mp4-muxer.min.js'), 'utf8'));
const Mp4Muxer = globalThis.Mp4Muxer;

const CONFIGS = {
  avc: { codec: 'avc1.640028', description: Uint8Array.from(H.avcC(0x64, 0, 0x28)) },
  hevc: { codec: 'hvc1.1.6.L93.B0', description: Uint8Array.from([1, 0x01, 0x60, 0, 0, 0, 0xb0, 0, 0, 0, 0, 0, 93, 0xf0, 0, 0xfc, 0xfd, 0xf8, 0xf8, 0, 0, 0x0f, 0]) },
  vp9: { codec: 'vp09.00.10.08', colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false } },
  // mp4-muxer writes its own minimal av1C (profile and level 0), whatever the config says
  av1: { codec: 'av01.0.04M.08', description: Uint8Array.from([0x81, 0x04, 0x0c, 0]), written: 'av01.0.00M.08' },
};

// Writes `frames` frames at `fps` (B-frames: presentation I0 P3 B1 B2 …), returns { bytes, frames: [{ pts, data, key }] in
// decode order } so the table can be compared with what went in.
function muxed({ codec = 'avc', fps = 30, frames = 45, bframes = false, fastStart = 'in-memory', rotation = 0, gop = null }) {
  const target = new Mp4Muxer.ArrayBufferTarget();
  // minFragmentDuration below the key interval: each key frame starts a fragment (mp4-muxer writes the flags of only
  // one key frame per fragment)
  const mux = new Mp4Muxer.Muxer({ target, video: { codec, width: 320, height: 180, rotation }, fastStart, firstTimestampBehavior: 'offset',
    minFragmentDuration: 0.5 });
  const keyEvery = gop || Math.round(fps);
  const order = bframes ? GEN.helpers.bOrder(frames, keyEvery) : Array.from({ length: frames }, (_, i) => i);
  const us = (p) => Math.round((p * 1e6) / fps);
  const written = [];
  order.forEach((p, d) => {
    const data = H.payload(codec + fps, d, 30 + ((d * 13) % 50));
    const key = p % keyEvery === 0;
    const dts = us(d) - (bframes ? us(2) : 0);
    mux.addVideoChunkRaw(data, key ? 'key' : 'delta', us(p), us(p + 1) - us(p), { decoderConfig: CONFIGS[codec] }, us(p) - dts);
    written.push({ pts: us(p) / 1e6, data, key });
  });
  mux.finalize();
  return { bytes: new Uint8Array(target.buffer), written };
}

async function checkMuxed(label, opts) {
  const o = Object.assign({ fps: 30 }, opts);
  const { bytes, written } = muxed(o);
  const r = reader(bytes);
  const movie = await ISO.parse(r.read, bytes.length);
  const v = movie.tracks[0];
  const t = v.table;
  const first = Math.min(...written.map((w) => w.pts));
  assert.equal(t.n, written.length, label + ' n');
  assert.equal(t.key.length, written.length, label + ' no pre-roll');
  written.forEach((w, d) => {
    assert.equal(t.key[d], w.key ? 1 : 0, label + ' key ' + d);
    assert.deepEqual(Buffer.from(bytes.subarray(t.off[d], t.off[d] + t.size[d])), Buffer.from(w.data), label + ' off/size ' + d);
  });
  const byPts = written.map((w, d) => [w.pts - first, d]).sort((a, b) => a[0] - b[0]);
  byPts.forEach(([pts, d], i) => {
    assert.equal(t.dec[i], d, label + ' dec ' + i);
    // mp4-muxer rounds decode times, composition offsets and (fragmented) tfdt to its 57600 Hz timescale separately:
    // within 2 ticks of the µs timestamps it was given; the frame choice below is exact regardless
    assert.ok(Math.abs(t.pts[i] - pts) <= 2 / 57600 + 1e-9, label + ' pts ' + i + ': ' + t.pts[i] + ' vs ' + pts);
    assert.equal(SM.sampleAt(t, i / o.fps), i, label + ' sampleAt(i / fps) = i at ' + i);
  });
  const rot = o.rotation || 0;
  assert.equal(v.rot, rot, label + ' rot');
  assert.deepEqual([v.w, v.h], rot % 180 ? [180, 320] : [320, 180], label + ' displayed size');
  const config = CONFIGS[o.codec || 'avc'];
  assert.equal(v.codec, config.written || config.codec, label + ' codec string');
  for (const [at, n] of r.log) {
    for (let d = 0; d < t.key.length; d++) assert.ok(!(at < t.off[d] + t.size[d] && t.off[d] < at + n), label + ' no payload read');
  }
}

test('isobmff: mp4-muxer files at 24, 25, 29.97, 30 and 60 fps, with and without B-frames, fragmented, rotated', async () => {
  for (const fps of [24, 25, 30000 / 1001, 30, 60]) {
    for (const bframes of [false, true]) {
      for (const fastStart of ['in-memory', false, 'fragmented']) {
        await checkMuxed(`fps ${fps.toFixed(2)} b=${bframes} ${fastStart}`, { fps, bframes, fastStart, frames: Math.round(fps * 2.5) });
      }
    }
  }
  for (const rotation of [0, 90, 180, 270]) await checkMuxed('rotation ' + rotation, { rotation });
  for (const codec of ['hevc', 'vp9', 'av1']) await checkMuxed('codec ' + codec, { codec, bframes: codec === 'hevc' });
});

test('codecString: avc, hevc (Annex E), vp09 from vpcC, av01 (bit depths), vp8, others unchanged', () => {
  assert.equal(SM.codecString({ fourcc: 'avc1', config: Uint8Array.from([1, 0x64, 0x00, 0x28]) }), 'avc1.640028');
  assert.equal(SM.codecString({ fourcc: 'avc3', config: Uint8Array.from([1, 0x42, 0xe0, 0x1e]) }), 'avc3.42E01E');
  assert.equal(SM.codecString({ fourcc: 'hvc1', config: CONFIGS.hevc.description }), 'hvc1.1.6.L93.B0');
  const main10 = Uint8Array.from([1, 0x22, 0x20, 0, 0, 0, 0x90, 0, 0, 0, 0, 0, 120]);   // tier high, profile 2
  assert.equal(SM.codecString({ fourcc: 'hev1', config: main10 }), 'hev1.2.4.H120.90');
  assert.equal(SM.codecString({ fourcc: 'vp09', config: Uint8Array.from([1, 0, 0, 0, 2, 31, 0xa2, 1, 1, 1, 0]) }), 'vp09.02.31.10');
  assert.equal(SM.codecString({ fourcc: 'vp09', profile: 0, level: 21, depth: 8 }), 'vp09.00.21.08');
  assert.equal(SM.codecString({ fourcc: 'av01', config: Uint8Array.from([0x81, 0x48, 0x4c, 0]) }), 'av01.2.08M.10', 'profile 2 high bit depth');
  assert.equal(SM.codecString({ fourcc: 'av01', config: Uint8Array.from([0x81, 0x48, 0x6c, 0]) }), 'av01.2.08M.12', 'profile 2 twelve bit');
  assert.equal(SM.codecString({ fourcc: 'av01', config: Uint8Array.from([0x81, 0x2d, 0xcc, 0]) }), 'av01.1.13H.10');
  assert.equal(SM.codecString({ fourcc: 'vp08' }), 'vp8');
  assert.equal(SM.codecString({ fourcc: 'apch' }), 'apch');
  assert.equal(SM.vp9Level(1920, 1080, 30), 40);
  assert.equal(SM.vp9Level(1920, 1080, 60), 41);
  assert.equal(SM.vp9Level(3840, 2160, 30), 50);
  assert.equal(SM.vp9Level(64, 36, 25), 10);
});
