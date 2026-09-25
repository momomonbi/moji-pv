/* 文字PVメーカー v2 — original work. Store-only streaming ZIP writer (ZIP64 when needed) with a table-driven CRC-32 (§4.21). */
MV.def('export/zip', [], () => {
  'use strict';

  const SIG = Object.freeze({ local: 0x04034b50, central: 0x02014b50, end: 0x06054b50, end64: 0x06064b50, locator64: 0x07064b50 });
  const MAX16 = 0xffff;
  const MAX32 = 0xffffffff;
  const UTF8_NAMES = 0x0800;           // general purpose flag bit 11: names are UTF-8
  const VERSION_STORE = 10;            // 1.0: stored entries
  const VERSION_ZIP64 = 45;            // 4.5: ZIP64 extensions
  const ZIP64_EXTRA = 0x0001;

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function zipError(code, message) {
    const e = new Error(message);
    e.name = 'ZipError';
    e.code = code;
    return e;
  }

  // crc32(bytes, previous = 0) → uint32; pass the previous result to continue a running CRC over several buffers.
  function crc32(bytes, previous = 0) {
    let c = (previous ^ MAX32) >>> 0;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ MAX32) >>> 0;
  }

  function utf8(text) {
    const out = [];
    for (const ch of String(text)) {
      let cp = ch.codePointAt(0);
      if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;   // an unpaired surrogate: U+FFFD, as TextEncoder does
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
    return Uint8Array.from(out);
  }

  // MS-DOS time and date fields; without a date the archive is reproducible (1980-01-01 00:00).
  function dosStamp(d) {
    if (!d) return { time: 0, date: (1 << 5) | 1 };
    const year = Math.min(2107, Math.max(1980, d.year));
    return {
      time: (d.hour << 11) | (d.minute << 5) | (d.second >> 1),
      date: ((year - 1980) << 9) | (d.month << 5) | d.day,
    };
  }

  function setU64(view, at, value) {
    view.setUint32(at, value % 0x100000000, true);
    view.setUint32(at + 4, Math.floor(value / 0x100000000), true);
  }

  function localHeader(entry, stamp) {
    const extra = entry.zip64 ? 20 : 0;
    const bytes = new Uint8Array(30 + entry.name.length + extra);
    const v = new DataView(bytes.buffer);
    v.setUint32(0, SIG.local, true);
    v.setUint16(4, entry.zip64 ? VERSION_ZIP64 : VERSION_STORE, true);
    v.setUint16(6, UTF8_NAMES, true);
    v.setUint16(8, 0, true);                       // method: stored
    v.setUint16(10, stamp.time, true);
    v.setUint16(12, stamp.date, true);
    v.setUint32(14, entry.crc, true);
    v.setUint32(18, entry.zip64 ? MAX32 : entry.size, true);
    v.setUint32(22, entry.zip64 ? MAX32 : entry.size, true);
    v.setUint16(26, entry.name.length, true);
    v.setUint16(28, extra, true);
    bytes.set(entry.name, 30);
    if (entry.zip64) {
      const at = 30 + entry.name.length;
      v.setUint16(at, ZIP64_EXTRA, true);
      v.setUint16(at + 2, 16, true);
      setU64(v, at + 4, entry.size);
      setU64(v, at + 12, entry.size);
    }
    return bytes;
  }

  function centralHeader(entry, stamp, force64) {
    const bigSize = force64 || entry.size >= MAX32;
    const bigOffset = force64 || entry.offset >= MAX32;
    const fields = (bigSize ? 2 : 0) + (bigOffset ? 1 : 0);
    const extra = fields ? 4 + 8 * fields : 0;
    const bytes = new Uint8Array(46 + entry.name.length + extra);
    const v = new DataView(bytes.buffer);
    const version = extra || entry.zip64 ? VERSION_ZIP64 : VERSION_STORE;
    v.setUint32(0, SIG.central, true);
    v.setUint16(4, version, true);                 // made by: MS-DOS host, this spec version
    v.setUint16(6, version, true);
    v.setUint16(8, UTF8_NAMES, true);
    v.setUint16(10, 0, true);
    v.setUint16(12, stamp.time, true);
    v.setUint16(14, stamp.date, true);
    v.setUint32(16, entry.crc, true);
    v.setUint32(20, bigSize ? MAX32 : entry.size, true);
    v.setUint32(24, bigSize ? MAX32 : entry.size, true);
    v.setUint16(28, entry.name.length, true);
    v.setUint16(30, extra, true);
    v.setUint16(32, 0, true);                      // comment length
    v.setUint16(34, 0, true);                      // disk number
    v.setUint16(36, 0, true);                      // internal attributes
    v.setUint32(38, 0, true);                      // external attributes
    v.setUint32(42, bigOffset ? MAX32 : entry.offset, true);
    bytes.set(entry.name, 46);
    if (extra) {
      let at = 46 + entry.name.length;
      v.setUint16(at, ZIP64_EXTRA, true);
      v.setUint16(at + 2, 8 * fields, true);
      at += 4;
      if (bigSize) { setU64(v, at, entry.size); setU64(v, at + 8, entry.size); at += 16; }
      if (bigOffset) setU64(v, at, entry.offset);
    }
    return bytes;
  }

  function end64Record(count, cdSize, cdStart) {
    const bytes = new Uint8Array(56);
    const v = new DataView(bytes.buffer);
    v.setUint32(0, SIG.end64, true);
    setU64(v, 4, 44);                              // size of the rest of this record
    v.setUint16(12, VERSION_ZIP64, true);
    v.setUint16(14, VERSION_ZIP64, true);
    setU64(v, 24, count);
    setU64(v, 32, count);
    setU64(v, 40, cdSize);
    setU64(v, 48, cdStart);
    return bytes;
  }

  function end64Locator(recordAt) {
    const bytes = new Uint8Array(20);
    const v = new DataView(bytes.buffer);
    v.setUint32(0, SIG.locator64, true);
    setU64(v, 8, recordAt);
    v.setUint32(16, 1, true);                      // total number of disks
    return bytes;
  }

  function endRecord(count, cdSize, cdStart, zip64) {
    const bytes = new Uint8Array(22);
    const v = new DataView(bytes.buffer);
    v.setUint32(0, SIG.end, true);
    v.setUint16(8, zip64 ? MAX16 : count, true);
    v.setUint16(10, zip64 ? MAX16 : count, true);
    v.setUint32(12, zip64 ? MAX32 : cdSize, true);
    v.setUint32(16, zip64 ? MAX32 : cdStart, true);
    return bytes;
  }

  // createZip(write, { date?, zip64? }) → { add(name, bytes), finish(), bytes, count }. `write(Uint8Array)` receives the
  // archive in order (never seeks back): local header and data per entry, then the central directory. Entries are stored
  // uncompressed (PNG data is already compressed). ZIP64 records are written when sizes, offsets or the entry count
  // need them, or always with `zip64: true`. Calls are queued, so add() may be called without awaiting the previous one.
  function createZip(write, opts) {
    if (typeof write !== 'function') throw zipError('args', 'createZip: write must be a function');
    const o = opts || {};
    const stamp = dosStamp(o.date);
    const force64 = !!o.zip64;
    const entries = [];
    const names = new Set();
    let offset = 0;
    let closed = false;
    let chain = Promise.resolve();

    async function put(bytes) {
      await write(bytes);
      offset += bytes.length;
    }

    function queue(job) {
      const run = chain.then(job);
      chain = run.catch(() => {});
      return run;
    }

    function add(name, bytes) {
      if (closed) return Promise.reject(zipError('closed', 'zip: add after finish'));
      if (typeof name !== 'string' || !name || name.length > MAX16) return Promise.reject(zipError('name', 'zip: bad entry name'));
      if (names.has(name)) return Promise.reject(zipError('duplicate', 'zip: duplicate entry ' + name));
      if (!(bytes instanceof Uint8Array)) return Promise.reject(zipError('args', 'zip: entry data must be a Uint8Array'));
      names.add(name);
      return queue(async () => {
        const entry = { name: utf8(name), crc: crc32(bytes), size: bytes.length, offset, zip64: force64 || bytes.length >= MAX32 };
        await put(localHeader(entry, stamp));
        await put(bytes);
        entries.push(entry);
      });
    }

    function finish() {
      if (closed) return Promise.reject(zipError('closed', 'zip: finish twice'));
      closed = true;
      return queue(async () => {
        const cdStart = offset;
        for (const entry of entries) await put(centralHeader(entry, stamp, force64));
        const cdSize = offset - cdStart;
        const zip64 = force64 || entries.length >= MAX16 || cdStart >= MAX32 || cdSize >= MAX32;
        if (zip64) {
          const recordAt = offset;
          await put(end64Record(entries.length, cdSize, cdStart));
          await put(end64Locator(recordAt));
        }
        await put(endRecord(entries.length, cdSize, cdStart, zip64));
        return { bytes: offset, entries: entries.length, zip64 };
      });
    }

    return {
      add,
      finish,
      get bytes() { return offset; },
      get count() { return entries.length; },
    };
  }

  return { SIG, crc32, createZip, utf8 };
});
