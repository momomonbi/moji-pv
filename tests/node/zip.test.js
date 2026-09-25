/* 文字PVメーカー v2 — original work. Tests for export/zip (DESIGN §8.2 zip.test.js): CRC-32 vectors and a small own reader. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { load } = require('../helpers/load.js');

const MV = load();
const Z = MV.use('export/zip');
const rng = MV.use('core/rng');

const bytesOf = (s) => Uint8Array.from(Buffer.from(s, 'utf8'));

function u64(view, at) { return view.getUint32(at, true) + view.getUint32(at + 4, true) * 0x100000000; }

// The zip64 extended information extra field: the values whose 32-bit fields are 0xFFFFFFFF, in this order.
function zip64Values(view, at, len, want) {
  const out = {};
  for (let p = at; p < at + len;) {
    const id = view.getUint16(p, true), size = view.getUint16(p + 2, true);
    if (id === 1) {
      let q = p + 4;
      for (const key of want) { out[key] = u64(view, q); q += 8; }
    }
    p += 4 + size;
  }
  return out;
}

// A small reader: end record (and ZIP64 records), central directory, then each local header and its stored data.
function readZip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= 0; i--) if (v.getUint32(i, true) === Z.SIG.end) { end = i; break; }
  assert.ok(end >= 0, 'end of central directory record');
  let count = v.getUint16(end + 10, true), cdSize = v.getUint32(end + 12, true), cdStart = v.getUint32(end + 16, true);
  let zip64 = false;
  if (end >= 20 && v.getUint32(end - 20, true) === Z.SIG.locator64) {
    zip64 = true;
    const at = u64(v, end - 12);
    assert.equal(v.getUint32(at, true), Z.SIG.end64, 'ZIP64 end record where the locator points');
    assert.equal(u64(v, at + 4), 44);
    count = u64(v, at + 32);
    cdSize = u64(v, at + 40);
    cdStart = u64(v, at + 48);
    assert.equal(at, cdStart + cdSize, 'ZIP64 end record follows the central directory');
  } else {
    assert.equal(end, cdStart + cdSize, 'end record follows the central directory');
  }
  const entries = [];
  let p = cdStart;
  for (let k = 0; k < count; k++) {
    assert.equal(v.getUint32(p, true), Z.SIG.central, 'central header ' + k);
    const e = {
      versionNeeded: v.getUint16(p + 6, true), flags: v.getUint16(p + 8, true), method: v.getUint16(p + 10, true),
      time: v.getUint16(p + 12, true), date: v.getUint16(p + 14, true), crc: v.getUint32(p + 16, true),
      csize: v.getUint32(p + 20, true), size: v.getUint32(p + 24, true), offset: v.getUint32(p + 42, true),
    };
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    e.name = Buffer.from(bytes.subarray(p + 46, p + 46 + nameLen)).toString('utf8');
    const want = [];
    if (e.size === 0xffffffff) want.push('size');
    if (e.csize === 0xffffffff) want.push('csize');
    if (e.offset === 0xffffffff) want.push('offset');
    Object.assign(e, zip64Values(v, p + 46 + nameLen, extraLen, want));
    p += 46 + nameLen + extraLen + commentLen;
    const l = e.offset;
    assert.equal(v.getUint32(l, true), Z.SIG.local, 'local header of ' + e.name);
    assert.equal(v.getUint16(l + 8, true), e.method);
    assert.equal(v.getUint32(l + 14, true), e.crc);
    const lNameLen = v.getUint16(l + 26, true), lExtraLen = v.getUint16(l + 28, true);
    assert.equal(Buffer.from(bytes.subarray(l + 30, l + 30 + lNameLen)).toString('utf8'), e.name);
    const start = l + 30 + lNameLen + lExtraLen;
    e.data = bytes.subarray(start, start + e.size);
    entries.push(e);
  }
  assert.equal(p, cdStart + cdSize, 'central directory size');
  return { entries, zip64 };
}

function collector() {
  const parts = [];
  const write = async (b) => {
    assert.ok(b instanceof Uint8Array);
    parts.push(Uint8Array.from(b));
    await new Promise((r) => setImmediate(r));
  };
  return { write, bytes: () => Uint8Array.from(Buffer.concat(parts)), parts };
}

test('crc32: standard vectors and running CRCs', () => {
  assert.equal(Z.crc32(new Uint8Array(0)), 0);
  assert.equal(Z.crc32(bytesOf('a')), 0xe8b7be43);
  assert.equal(Z.crc32(bytesOf('123456789')), 0xcbf43926);
  assert.equal(Z.crc32(bytesOf('The quick brown fox jumps over the lazy dog')), 0x414fa339);
  const whole = bytesOf('Hello, 文字PV!');
  assert.equal(Z.crc32(whole.subarray(5), Z.crc32(whole.subarray(0, 5))), Z.crc32(whole));
  if (typeof zlib.crc32 === 'function') {
    const s = rng.stream('crc', 4);
    const data = Uint8Array.from({ length: 10000 }, () => s.int(0, 255));
    assert.equal(Z.crc32(data), zlib.crc32(data), 'same as zlib');
  }
});

test('zip: store-only archive with UTF-8 names reads back entry by entry', async () => {
  const out = collector();
  const zip = Z.createZip(out.write);
  const s = rng.stream('zipdata', 1);
  const files = [
    ['frames/a_00000.png', Uint8Array.from({ length: 3000 }, () => s.int(0, 255))],
    ['夜明けのうた_00001.png', bytesOf('second')],
    ['empty.txt', new Uint8Array(0)],
  ];
  const pending = files.map(([name, data]) => zip.add(name, data));   // queued without awaiting each one
  await Promise.all(pending);
  assert.equal(zip.count, 3);
  const done = await zip.finish();
  const bytes = out.bytes();
  assert.equal(done.bytes, bytes.length);
  assert.equal(zip.bytes, bytes.length);
  assert.equal(done.entries, 3);
  assert.equal(done.zip64, false);
  const read = readZip(bytes);
  assert.equal(read.zip64, false);
  assert.deepEqual(read.entries.map((e) => e.name), files.map((f) => f[0]));
  read.entries.forEach((e, i) => {
    assert.equal(e.method, 0, 'stored');
    assert.equal(e.flags & 0x0800, 0x0800, 'UTF-8 names');
    assert.equal(e.versionNeeded, 10);
    assert.equal(e.size, e.csize);
    assert.deepEqual(Buffer.from(e.data), Buffer.from(files[i][1]));
    assert.equal(e.crc, Z.crc32(files[i][1]));
    assert.equal(e.time, 0);
    assert.equal(e.date, 0x21, 'fixed 1980-01-01 stamp');
  });
  assert.equal(read.entries[0].offset, 0);
});

test('zip: names are always valid UTF-8 — emoji as 4 bytes, an unpaired surrogate as U+FFFD (like TextEncoder)', async () => {
  const out = collector();
  const zip = Z.createZip(out.write);
  const names = ['a'.repeat(79) + '\ud83c_00000.png', '🎵 live_00001.png', 'x\udfffy.png', '👩‍👩‍👧.png'];
  for (const name of names) await zip.add(name, bytesOf(name.length + ''));
  await zip.finish();
  const bytes = out.bytes();
  const strict = new TextDecoder('utf-8', { fatal: true });
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const read = readZip(bytes);
  read.entries.forEach((e, i) => {
    const raw = bytes.subarray(e.offset + 30, e.offset + 30 + v.getUint16(e.offset + 26, true));
    assert.deepEqual(Buffer.from(raw), Buffer.from(new TextEncoder().encode(names[i])), 'same bytes as TextEncoder: ' + i);
    assert.doesNotThrow(() => strict.decode(raw), 'strict UTF-8: ' + i);
  });
  assert.equal(read.entries[0].name, 'a'.repeat(79) + '\ufffd_00000.png');
  assert.equal(read.entries[1].name, names[1]);
  assert.equal(read.entries[2].name, 'x\ufffdy.png');
  assert.equal(read.entries[3].name, names[3]);
});

test('zip: writes go strictly forward, one call per header or payload', async () => {
  const out = collector();
  const zip = Z.createZip(out.write);
  await zip.add('a.bin', bytesOf('aaaa'));
  await zip.add('b.bin', bytesOf('bb'));
  await zip.finish();
  const sizes = out.parts.map((b) => b.length);
  assert.deepEqual(sizes, [30 + 5, 4, 30 + 5, 2, 46 + 5, 46 + 5, 22]);
});

test('zip: forced ZIP64 records read back, including the extra fields', async () => {
  const out = collector();
  const zip = Z.createZip(out.write, { zip64: true });
  await zip.add('one.png', bytesOf('first file'));
  await zip.add('two.png', bytesOf('second'));
  const done = await zip.finish();
  assert.equal(done.zip64, true);
  const read = readZip(out.bytes());
  assert.equal(read.zip64, true);
  assert.deepEqual(read.entries.map((e) => [e.name, Buffer.from(e.data).toString()]), [['one.png', 'first file'], ['two.png', 'second']]);
  for (const e of read.entries) assert.equal(e.versionNeeded, 45);
  assert.equal(read.entries[1].offset, 30 + 7 + 20 + 10, 'offset from the ZIP64 extra field');
});

test('zip: the same input gives the same bytes; a date sets the DOS stamp', async () => {
  const make = async (opts) => {
    const out = collector();
    const zip = Z.createZip(out.write, opts);
    await zip.add('x.png', bytesOf('xyz'));
    await zip.finish();
    return out.bytes();
  };
  assert.deepEqual(await make(), await make());
  const stamped = readZip(await make({ date: { year: 2026, month: 9, day: 24, hour: 13, minute: 45, second: 31 } })).entries[0];
  assert.equal(stamped.date, ((2026 - 1980) << 9) | (9 << 5) | 24);
  assert.equal(stamped.time, (13 << 11) | (45 << 5) | 15);
});

test('zip: errors — duplicate names, bad data, add after finish, finish twice, a failing writer', async () => {
  const zip = Z.createZip(collector().write);
  await zip.add('a', bytesOf('1'));
  await assert.rejects(zip.add('a', bytesOf('2')), (e) => e.code === 'duplicate');
  await assert.rejects(zip.add('b', [1, 2]), (e) => e.code === 'args');
  await assert.rejects(zip.add('', bytesOf('1')), (e) => e.code === 'name');
  await zip.finish();
  await assert.rejects(zip.add('c', bytesOf('1')), (e) => e.code === 'closed');
  await assert.rejects(zip.finish(), (e) => e.code === 'closed');
  assert.throws(() => Z.createZip(null), (e) => e.code === 'args');
  const broken = Z.createZip(async () => { throw new Error('disk full'); });
  await assert.rejects(broken.add('a', bytesOf('1')), /disk full/);
});
