/* 文字PVメーカー v2 — original work. Tests for export/unzip (DESIGN_2_1 §12.4, §12.8 unzip.test.js). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const Z = MV.use('export/zip');
const U = MV.use('export/unzip');
const rng = MV.use('core/rng');

const bytesOf = (s) => Uint8Array.from(Buffer.from(s, 'utf8'));

async function zipOf(files, opts) {
  const parts = [];
  const zip = Z.createZip(async (b) => { parts.push(Uint8Array.from(b)); }, opts);
  for (const [name, data] of files) await zip.add(name, data);
  await zip.finish();
  return Uint8Array.from(Buffer.concat(parts));
}

function reader(bytes) {
  const log = [];
  return { log, read: async (at, n) => { log.push([at, Math.min(n, Math.max(0, bytes.length - at))]); return bytes.subarray(at, at + n); } };
}

async function readAll(bytes, opts) {
  const r = reader(bytes);
  const z = await U.openZip(r.read, bytes.length, opts);
  const out = [];
  for (const e of z.entries.values()) {
    const start = await U.dataStart(r.read, e);
    out.push([e.name, bytes.subarray(start, start + e.bytes), e]);
  }
  return { z, out, log: r.log };
}

test('openZip round trip with createZip: store-only, ZIP64 off and on, 0–3 entries, a UTF-8 name at the limit', async () => {
  const s = rng.stream('unzip', 1);
  const longName = 'あ'.repeat(21845);                      // 65,535 bytes of UTF-8
  const all = [['mimetype', bytesOf('application/vnd.mojipv+zip')], ['media/写真.png', Uint8Array.from({ length: 3000 }, () => s.int(0, 255))],
    [longName, bytesOf('long name')]];
  for (const zip64 of [false, true]) {
    for (let n = 0; n <= 3; n++) {
      const files = all.slice(0, n);
      const bytes = await zipOf(files, { zip64 });
      const { z, out } = await readAll(bytes);
      assert.equal(z.zip64, zip64, n + ' entries, zip64 ' + zip64);
      assert.deepEqual(out.map(([name]) => name), files.map(([name]) => name));
      out.forEach(([name, data, e], i) => {
        assert.deepEqual(Buffer.from(data), Buffer.from(files[i][1]), name.slice(0, 20));
        assert.equal(e.crc, Z.crc32(files[i][1]));
        assert.equal(e.method, 0);
        assert.equal(e.bytes, files[i][1].length);
      });
      if (n) assert.equal(out[0][2].localOffset, 0);
    }
  }
});

test('openZip reads only headers: the end record, the directory and each local header (a counting read)', async () => {
  const s = rng.stream('unzip', 2);
  const big = Uint8Array.from({ length: 200000 }, () => s.int(0, 255));
  for (const zip64 of [false, true]) {
    const bytes = await zipOf([['mimetype', bytesOf('x')], ['media/a.mp4', big], ['media/b.webm', big.subarray(0, 150000)], ['project.json', bytesOf('{}')]], { zip64 });
    const { z, log } = await readAll(bytes);
    const data = [];
    for (const e of z.entries.values()) {
      const start = e.localOffset + 30 + Buffer.byteLength(e.name) + (zip64 ? 20 : 0);
      if (e.bytes > 100) data.push([start, start + e.bytes]);
    }
    for (const [at, n] of log) {
      for (const [a, b] of data) assert.ok(at + n <= a || at >= b, 'zip64 ' + zip64 + ': read ' + at + '+' + n + ' touches entry data ' + a + '–' + b);
    }
    const total = log.reduce((sum, [, n]) => sum + n, 0);
    assert.ok(total < 1200, 'zip64 ' + zip64 + ': ' + total + ' bytes read');
  }
});

test('openZip: an archive comment is found by the tail scan', async () => {
  const bytes = await zipOf([['a.txt', bytesOf('hello')]]);
  const comment = bytesOf('a comment after the end record');
  const withComment = new Uint8Array(bytes.length + comment.length);
  withComment.set(bytes);
  withComment.set(comment, bytes.length);
  new DataView(withComment.buffer).setUint16(bytes.length - 2, comment.length, true);
  const { out } = await readAll(withComment);
  assert.equal(Buffer.from(out[0][1]).toString(), 'hello');
});

async function code(bytes, opts) {
  try { await readAll(bytes, opts); } catch (e) { assert.ok(e instanceof U.ZipReadError, String(e)); return e.code; }
  return 'ok';
}

// Rewrites the central directory header of entry k with fn(view, offset).
async function patched(files, k, fn, opts) {
  const bytes = await zipOf(files, opts);
  const v = new DataView(bytes.buffer);
  const cdStart = v.getUint32(bytes.length - 6, true);
  let p = cdStart;
  for (let i = 0; i < k; i++) p += 46 + v.getUint16(p + 28, true) + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  fn(v, p, bytes);
  return bytes;
}

test('openZip errors: truncated end record, wrong central size, compressed or encrypted entries, bad names, too many entries', async () => {
  const files = [['mimetype', bytesOf('application/vnd.mojipv+zip')], ['media/a.png', bytesOf('png data')], ['project.json', bytesOf('{}')]];
  const good = await zipOf(files);
  assert.equal(await code(good), 'ok');
  assert.equal(await code(good.subarray(0, good.length - 1)), 'truncated', 'the end record cut off');
  assert.equal(await code(good.subarray(0, good.length - 30)), 'truncated', 'the directory cut off');
  assert.equal(await code(good.subarray(0, 60)), 'truncated', 'only the first entry');
  assert.equal(await code(bytesOf('{"format":"mojipv.project"}')), 'not-zip');
  assert.equal(await code(new Uint8Array(0)), 'not-zip');
  const wrongSize = Uint8Array.from(good);
  const v = new DataView(wrongSize.buffer);
  v.setUint32(wrongSize.length - 10, v.getUint32(wrongSize.length - 10, true) - 1, true);
  assert.equal(await code(wrongSize), 'truncated', 'a central directory size that does not match');
  const wrongCount = Uint8Array.from(good);
  new DataView(wrongCount.buffer).setUint16(wrongCount.length - 12, 2, true);
  new DataView(wrongCount.buffer).setUint16(wrongCount.length - 14, 2, true);
  assert.equal(await code(wrongCount), 'truncated', 'fewer entries than the directory holds');
  assert.equal(await code(await patched(files, 1, (x, p) => x.setUint16(p + 10, 8, true))), 'unsupported', 'deflate');
  assert.equal(await code(await patched(files, 1, (x, p) => x.setUint16(p + 8, 0x0801, true))), 'unsupported', 'encrypted');
  assert.equal(await code(await patched(files, 1, (x, p) => x.setUint32(p + 20, 3, true))), 'bad-entry', 'stored sizes differ');
  const multi = Uint8Array.from(good);
  new DataView(multi.buffer).setUint16(multi.length - 18, 1, true);
  assert.equal(await code(multi), 'unsupported', 'a multi-disk archive');
  for (const name of ['../evil', 'a/../../b', '/abs', 'C:/x', 'back\\slash', 'nul\0byte']) {
    assert.equal(await code(await zipOf([['a', bytesOf('1')], [name, bytesOf('2')]])), 'bad-entry', JSON.stringify(name));
  }
  assert.equal(await code(await patched([['ok', bytesOf('1')]], 0, (x, p, b) => { b[p + 46] = 0xff; })), 'bad-entry', 'a name that is not UTF-8');
  const many = Array.from({ length: 1001 }, (_, i) => ['f' + i, bytesOf(String(i))]);
  assert.equal(await code(await zipOf(many)), 'unsupported', '1,001 entries');
  assert.equal(await code(await zipOf(many.slice(0, 1000))), 'ok', '1,000 entries');
  assert.equal(await code(await zipOf(many.slice(0, 20)), { maxEntries: 10 }), 'unsupported', 'a lower limit');
  const localBad = Uint8Array.from(good);
  const z = await U.openZip(reader(localBad).read, localBad.length);
  localBad[z.entries.get('media/a.png').localOffset] = 0;
  await assert.rejects(U.dataStart(reader(localBad).read, z.entries.get('media/a.png')), (e) => e.code === 'bad-entry');
});

test('utf8Decode is strict; badName', () => {
  assert.equal(U.utf8Decode(bytesOf('写真 📷.png')), '写真 📷.png');
  assert.equal(U.utf8Decode(Uint8Array.of(0xc0, 0x80)), null, 'overlong');
  assert.equal(U.utf8Decode(Uint8Array.of(0xed, 0xa0, 0x80)), null, 'a surrogate');
  assert.equal(U.utf8Decode(Uint8Array.of(0xe3, 0x81)), null, 'cut short');
  assert.equal(U.badName('media/a.png'), false);
  assert.equal(U.badName('a..b/c'), false, 'dots inside a name are fine');
  assert.equal(U.badName(''), true);
});
