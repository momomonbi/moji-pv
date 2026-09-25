/* 文字PVメーカー v2 — original work. Tests for export/package (DESIGN_2_1 §12.2, §12.8 package.test.js). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../helpers/load.js');

const MV = load();
const PKG = MV.use('export/package');
const Z = MV.use('export/zip');
const U = MV.use('export/unzip');
const D = MV.use('core/doc');
const M = MV.use('core/migrate');
const SN = MV.use('media/sniff');
const rng = MV.use('core/rng');

const FIXTURE = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'fixtures', 'project_media.json'), 'utf8'));
const SHA1 = '3f2a9c0e1d2b3c4d5e6f708192a3b4c5d6e7f8e1';

// The fixture's document with a song, and "device" bytes for every asset but the last one.
function scene() {
  const file = M.parseFile(JSON.stringify(FIXTURE));
  const doc = Object.assign({}, file.doc, { song: { name: '夜明け.m4a', sha1: SHA1, seconds: 12, bpm: 120, offset: 0, meter: 4, bpmConfidence: null, digest: null, info: null } });
  const s = rng.stream('pkg', 1);
  const blobs = new Map();
  const media = new Map(), thumbs = new Map();
  const list = doc.media.list;
  for (const e of list.slice(0, -1)) {
    const data = Uint8Array.from({ length: 200 + s.int(0, 300) }, () => s.int(0, 255));
    blobs.set('media:' + e.id, new Blob([data], { type: e.mime }));
    media.set(e.id, { bytes: data.length, crc: Z.crc32(data), mime: e.mime });
    const th = Uint8Array.from({ length: 50 }, () => s.int(0, 255));
    blobs.set('thumb:' + e.id, new Blob([th], { type: 'image/webp' }));
    thumbs.set(e.id, { bytes: th.length, crc: Z.crc32(th) });
  }
  const song = Uint8Array.from({ length: 700 }, () => s.int(0, 255));
  blobs.set('song', new Blob([song], { type: 'audio/mp4' }));
  return { doc, side: file.side, blobs, have: { media, thumbs, song: { sha1: SHA1, bytes: song.length, crc: Z.crc32(song), mime: 'audio/mp4' } } };
}

// Writes the package the way ui/project_io.savePackage does: text entries with add, assets with addBlob.
async function write(lay, blobs) {
  const parts = [];
  const zip = Z.createZip(async (p) => { parts.push(p); });
  for (const o of lay.order) {
    if (o.text !== undefined) await zip.add(o.name, Z.utf8(o.text));
    else await zip.addBlob(o.name, blobs.get(o.role === 'song' ? 'song' : o.role + ':' + o.id), { crc: o.crc });
  }
  await zip.finish();
  const chunks = [];
  for (const p of parts) chunks.push(p instanceof Uint8Array ? p : new Uint8Array(await p.arrayBuffer()));
  return Uint8Array.from(Buffer.concat(chunks));
}

const readerOf = (bytes) => async (at, n) => bytes.subarray(at, at + n);

test('layout: the FROZEN entry order, names and extensions, missing ids, the manifest, and project.json = the light save', () => {
  const { doc, side, have } = scene();
  const lay = PKG.layout(doc, side, have);
  const ids = doc.media.list.map((e) => e.id);
  const names = lay.order.map((o) => o.name);
  const exts = { 'image/png': 'png', 'image/jpeg': 'jpg', 'video/mp4': 'mp4', 'video/webm': 'webm' };
  assert.deepEqual(names, ['mimetype', 'manifest.json', ...ids.slice(0, -1).map((id, i) => 'media/' + id + '.' + exts[doc.media.list[i].mime]),
    'song/' + SHA1 + '.m4a', ...ids.slice(0, -1).map((id) => 'thumbs/' + id + '.webp'), 'project.json']);
  assert.deepEqual(lay.order.map((o) => o.role), ['mimetype', 'manifest', ...ids.slice(0, -1).map(() => 'media'), 'song',
    ...ids.slice(0, -1).map(() => 'thumb'), 'project']);
  assert.deepEqual(lay.missing, [ids[ids.length - 1]], 'the asset whose bytes are not on this device');
  assert.deepEqual(lay.manifest.missing, lay.missing);
  assert.deepEqual(Object.keys(lay.manifest), ['format', 'v', 'app', 'project', 'files', 'missing']);
  assert.equal(lay.manifest.format, 'mojipv.package');
  assert.equal(lay.manifest.v, 1);
  assert.equal(lay.manifest.app, doc.meta.app);
  assert.deepEqual(lay.manifest.files.map((f) => f.path), names.slice(2, -1), 'files: every entry but mimetype, manifest and project, in file order');
  assert.deepEqual(Object.keys(lay.manifest.files[0]), ['path', 'role', 'id', 'bytes', 'crc', 'mime']);
  assert.deepEqual(Object.keys(lay.manifest.files.find((f) => f.role === 'song')), ['path', 'role', 'sha1', 'bytes', 'crc', 'mime']);
  assert.deepEqual(Object.keys(lay.manifest.files.find((f) => f.role === 'thumb')), ['path', 'role', 'id', 'bytes', 'crc']);
  assert.equal(lay.projectText, D.serialize({ doc, side }), 'project.json is byte-identical to the light save');
  assert.equal(JSON.parse(lay.manifestText).files.length, lay.manifest.files.length);
  // without a song on this device, or with none in the document
  assert.ok(!PKG.layout(doc, side, Object.assign({}, have, { song: null })).order.some((o) => o.role === 'song'));
  assert.ok(!PKG.layout(Object.assign({}, doc, { song: null }), side, have).order.some((o) => o.role === 'song'));
  const other = PKG.layout(doc, side, Object.assign({}, have, { song: Object.assign({}, have.song, { sha1: 'f'.repeat(40) }) }));
  assert.ok(!other.order.some((o) => o.role === 'song'), 'only the bytes of the document\'s song');
  const empty = PKG.layout(D.defaultDoc(), D.defaultSide(), {});
  assert.deepEqual(empty.order.map((o) => o.name), ['mimetype', 'manifest.json', 'project.json']);
});

test('the written package: sniffed as a package, mimetype text at offset 38, the manifest equals the directory, project.json last', async () => {
  const { doc, side, have, blobs } = scene();
  const lay = PKG.layout(doc, side, have);
  const bytes = await write(lay, blobs);
  assert.equal(bytes.length, lay.bytes, 'layout knows the exact file size');
  assert.equal(SN.sniff(bytes.subarray(0, 64)).kind, 'package');
  assert.equal(Buffer.from(bytes.subarray(38, 38 + PKG.MIME.length)).toString(), PKG.MIME);
  const z = await U.openZip(readerOf(bytes), bytes.length);
  assert.equal(PKG.mimetypeProblem(z.entries), null);
  const manifestEntry = z.entries.get('manifest.json');
  const start = await U.dataStart(readerOf(bytes), manifestEntry);
  const manifest = JSON.parse(Buffer.from(bytes.subarray(start, start + manifestEntry.bytes)).toString('utf8'));
  assert.deepEqual(manifest, lay.manifest);
  assert.deepEqual(PKG.manifestProblems(manifest, z.entries), []);
  for (const f of manifest.files) {
    const e = z.entries.get(f.path);
    assert.equal(e.bytes, f.bytes, f.path + ' bytes');
    assert.equal(e.crc, f.crc, f.path + ' crc');
  }
  const offsets = [...z.entries.values()].map((e) => e.localOffset);
  assert.equal(z.entries.get('project.json').localOffset, Math.max(...offsets), 'project.json is the last entry');
  const plan = PKG.readPlan(manifest, z.entries);
  assert.equal(plan.project, z.entries.get('project.json'));
  assert.deepEqual(plan.media.map((m) => m.id), doc.media.list.slice(0, -1).map((e) => e.id));
  assert.equal(plan.song.sha1, SHA1);
  assert.equal(plan.song.mime, 'audio/mp4');
  assert.deepEqual(plan.thumbs.map((t) => t.id), plan.media.map((m) => m.id));
  assert.deepEqual(plan.missing, lay.missing);
  const pStart = await U.dataStart(readerOf(bytes), plan.project);
  assert.equal(Buffer.from(bytes.subarray(pStart, pStart + plan.project.bytes)).toString('utf8'), D.serialize({ doc, side }));
  // the same input gives the same bytes (fixed DOS date, deterministic manifest)
  assert.deepEqual(Buffer.from(await write(PKG.layout(doc, side, have), blobs)), Buffer.from(bytes));
});

test('manifestProblems: every rule', async () => {
  const { doc, side, have, blobs } = scene();
  const lay = PKG.layout(doc, side, have);
  const bytes = await write(lay, blobs);
  const { entries } = await U.openZip(readerOf(bytes), bytes.length);
  const codes = (mutate) => {
    const m = JSON.parse(JSON.stringify(lay.manifest));
    mutate(m);
    return PKG.manifestProblems(m, entries).map((p) => p.split(':')[0]);
  };
  assert.deepEqual(codes(() => {}), []);
  assert.deepEqual(codes((m) => { m.format = 'zip'; }), ['format']);
  assert.deepEqual(codes((m) => { m.v = 2; }), ['newer']);
  assert.deepEqual(codes((m) => { m.v = 0; }), ['format']);
  assert.deepEqual(codes((m) => { m.project = 'other.json'; }), ['project']);
  assert.deepEqual(codes((m) => { m.files = {}; }), ['files']);
  assert.deepEqual(codes((m) => { m.files[0].role = 'poster'; }), ['role']);
  assert.deepEqual(codes((m) => { m.files[0].mime = 'image/gif'; }), ['path'], 'the extension must match the mime');
  assert.deepEqual(codes((m) => { m.files[0].id = 'a' + '0'.repeat(24); }), ['path'], 'the id must match the path');
  assert.deepEqual(codes((m) => { m.files[1].path = m.files[0].path; }), ['path'], 'a repeated path');
  assert.deepEqual(codes((m) => { m.files[0].bytes += 1; }), ['size']);
  assert.deepEqual(codes((m) => { m.files[0].crc ^= 1; }), ['size']);
  assert.deepEqual(codes((m) => { m.files[0].crc = String(m.files[0].crc); }), ['size']);
  assert.deepEqual(codes((m) => { m.files.push({ path: 'media/a' + 'b'.repeat(24) + '.png', role: 'media', id: 'a' + 'b'.repeat(24), bytes: 1, crc: 1, mime: 'image/png' }); }),
    ['files'], 'a file that is not in the archive');
  assert.deepEqual(codes((m) => { [m.files[0], m.files[1]] = [m.files[1], m.files[0]]; }), ['files'], 'out of file order');
  assert.deepEqual(codes((m) => { const song = m.files.find((f) => f.role === 'song'); m.files.push(Object.assign({}, song, { path: 'song/' + 'e'.repeat(40) + '.m4a', sha1: 'e'.repeat(40) })); }),
    ['role', 'files'], 'two songs (the second is not in the archive either)');
  assert.deepEqual(codes((m) => { m.files.find((f) => f.role === 'song').path = 'song/../x.m4a'; }), ['path']);
  assert.deepEqual(codes((m) => { m.missing = ['nope']; }), ['missing']);
  assert.deepEqual(codes((m) => { m.missing = [m.missing[0], m.missing[0]]; }), ['missing']);
  assert.deepEqual(codes((m) => { delete m.missing; }), ['missing']);
  assert.deepEqual(PKG.manifestProblems(null, entries).map((p) => p.split(':')[0]), ['format']);
  const noProject = new Map(entries);
  noProject.delete('project.json');
  assert.deepEqual(PKG.manifestProblems(lay.manifest, noProject).map((p) => p.split(':')[0]), ['project']);
  const moved = new Map(entries);
  moved.set('project.json', Object.assign({}, entries.get('project.json'), { localOffset: 1 }));
  assert.ok(PKG.manifestProblems(lay.manifest, moved).some((p) => p.startsWith('files: project.json must come after')));
  const firstNotMime = new Map(entries);
  firstNotMime.set('mimetype', Object.assign({}, entries.get('mimetype'), { crc: 1 }));
  assert.match(PKG.mimetypeProblem(firstNotMime), /does not hold/);
  const noMime = new Map([...entries].filter(([k]) => k !== 'mimetype'));
  assert.match(PKG.mimetypeProblem(noMime), /first entry/);
});

test('extOf and pathOf', () => {
  const table = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/x-m4v': 'm4v', 'video/webm': 'webm', 'video/x-matroska': 'mkv',
    'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/mp4': 'm4a', 'audio/flac': 'flac', 'audio/ogg': 'ogg', 'Audio/MP4; codecs=x': 'm4a',
    'application/octet-stream': 'bin', '': 'bin' };
  for (const [mime, ext] of Object.entries(table)) assert.equal(PKG.extOf(mime), ext, mime);
  assert.equal(PKG.extOf(undefined), 'bin');
  const id = 'a3f9c2d17b0e4a5c6d7e8f901';
  assert.equal(PKG.pathOf('media', id, 'video/mp4'), 'media/' + id + '.mp4');
  assert.equal(PKG.pathOf('song', SHA1, 'audio/wav'), 'song/' + SHA1 + '.wav');
  assert.equal(PKG.pathOf('thumb', id), 'thumbs/' + id + '.webp');
  assert.equal(PKG.EXT, '.mojipv');
  assert.equal(PKG.PACKAGE_V, 1);
});

test('archiveSize matches the writer with ZIP64 entries (a fake 4.1 GiB video)', async () => {
  const huge = Math.round(4.1 * 1024 ** 3);                   // 4.1 GiB: past the 32-bit sizes
  const order = [{ name: 'mimetype', bytes: 26 }, { name: 'manifest.json', bytes: 300 }, { name: 'media/a' + '1'.repeat(24) + '.mp4', bytes: huge },
    { name: 'project.json', bytes: 5000 }];
  let size = 0;
  const zip = Z.createZip(async (p) => { size += p instanceof Uint8Array ? p.length : p.size; });
  for (const o of order) {
    const fake = { size: o.bytes, slice() {}, arrayBuffer() {} };
    await zip.addBlob(o.name, fake, { crc: 1 });
  }
  const done = await zip.finish();
  assert.equal(done.zip64, true);
  assert.equal(PKG.archiveSize(order), size);
});
