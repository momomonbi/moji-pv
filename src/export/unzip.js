/* 文字PVメーカー v2 — original work. Random-access reader for store-only ZIP archives (ZIP64 included): the directory and local headers only (DESIGN_2_1 §12.4, §12.6). */
MV.def('export/unzip', [], () => {
  'use strict';

  // openZip(read, size, { maxEntries = 1000 }) → Promise<{ entries: Map<name, Entry>, zip64, cdStart }>
  //   Entry = { name, crc, bytes, localOffset, method, limit }   (limit: where the central directory starts)
  // dataStart(read, entry) → Promise<offset of the entry's data>   (reads the local header's name and extra lengths)
  // read(offset, length) → Promise<Uint8Array> reads the file (a File through Blob.slice in the browser). Only headers
  // are read: the end record (22 bytes when the archive has no comment, else the last 65,557 bytes), the ZIP64 locator
  // and record, the central directory, and one local header per dataStart.
  // Errors are ZipReadError with code 'not-zip' | 'truncated' | 'unsupported' | 'bad-entry'.

  const SIG = { local: 0x04034b50, central: 0x02014b50, end: 0x06054b50, end64: 0x06064b50, locator64: 0x07064b50 };
  const MAX16 = 0xffff, MAX32 = 0xffffffff;
  const END = 22, LOCATOR = 20, END64 = 56, CENTRAL = 46, LOCAL = 30;
  const TAIL = END + MAX16;                    // the end record plus the longest comment: 65,557 bytes
  const MAX_DIRECTORY = 64 * 1024 * 1024;

  class ZipReadError extends Error {
    constructor(code, message) { super(message || code); this.name = 'ZipReadError'; this.code = code; }
  }

  const fail = (code, message) => new ZipReadError(code, 'unzip: ' + message);

  function view(b) { return new DataView(b.buffer, b.byteOffset, b.byteLength); }
  function u64(v, p) { return v.getUint32(p, true) + v.getUint32(p + 4, true) * 0x100000000; }

  async function readExact(read, at, n) {
    if (at < 0) throw fail('truncated', 'offset before the start of the file');
    const got = await read(at, n);
    if (!got || got.length < n) throw fail('truncated', 'the file ends early (at ' + at + ')');
    return got.length === n ? got : got.subarray(0, n);
  }

  // Strict UTF-8 → string; null when the bytes are not valid UTF-8.
  function utf8Decode(b) {
    let s = '';
    for (let i = 0; i < b.length;) {
      const c = b[i];
      let cp, n;
      if (c < 0x80) { cp = c; n = 1; } else if (c >= 0xc2 && c < 0xe0) { cp = c & 0x1f; n = 2; } else if (c >= 0xe0 && c < 0xf0) { cp = c & 0x0f; n = 3; }
      else if (c >= 0xf0 && c < 0xf5) { cp = c & 0x07; n = 4; } else return null;
      if (i + n > b.length) return null;
      for (let k = 1; k < n; k++) {
        if ((b[i + k] & 0xc0) !== 0x80) return null;
        cp = (cp << 6) | (b[i + k] & 0x3f);
      }
      if ((n === 3 && (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff))) || (n === 4 && (cp < 0x10000 || cp > 0x10ffff))) return null;
      s += String.fromCodePoint(cp);
      i += n;
    }
    return s;
  }

  // A name a reader must refuse: '..' segments, an absolute path, a backslash, NUL or a drive letter.
  function badName(name) {
    return !name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)
      || name.split('/').includes('..');
  }

  // The end of central directory record: the last 22 bytes when there is no comment, else a scan of the tail.
  async function findEnd(read, size) {
    if (size >= END) {
      const last = await readExact(read, size - END, END);
      const v = view(last);
      if (v.getUint32(0, true) === SIG.end && v.getUint16(20, true) === 0) return { at: size - END, v };
    }
    const n = Math.min(size, TAIL);
    const tail = await readExact(read, size - n, n);
    const v = view(tail);
    for (let i = n - END; i >= 0; i--) {
      if (v.getUint32(i, true) === SIG.end && i + END + v.getUint16(i + 20, true) === n) {
        return { at: size - n + i, v: view(tail.subarray(i, i + END)) };
      }
    }
    return null;
  }

  async function openZip(read, size, opts) {
    const maxEntries = opts && Number.isInteger(opts.maxEntries) ? opts.maxEntries : 1000;
    if (typeof read !== 'function' || !(size >= 0)) throw fail('not-zip', 'nothing to read');
    if (size < END) throw fail(size >= 4 && await looksZip(read) ? 'truncated' : 'not-zip', 'too short for a ZIP');
    const end = await findEnd(read, size);
    if (!end) throw fail(await looksZip(read) ? 'truncated' : 'not-zip', 'no end of central directory record');
    const e = end.v;
    let disk = e.getUint16(4, true), cdDisk = e.getUint16(6, true), onDisk = e.getUint16(8, true), count = e.getUint16(10, true);
    let cdSize = e.getUint32(12, true), cdStart = e.getUint32(16, true);
    let zip64 = false, recordAt = end.at;
    if (end.at >= LOCATOR) {
      const loc = await readExact(read, end.at - LOCATOR, LOCATOR);
      const lv = view(loc);
      if (lv.getUint32(0, true) === SIG.locator64) {
        zip64 = true;
        if (lv.getUint32(4, true) !== 0 || lv.getUint32(16, true) !== 1) throw fail('unsupported', 'a multi-disk archive');
        recordAt = u64(lv, 8);
        if (recordAt + END64 > end.at - LOCATOR) throw fail('truncated', 'the ZIP64 end record is out of place');
        const rec = view(await readExact(read, recordAt, END64));
        if (rec.getUint32(0, true) !== SIG.end64) throw fail('truncated', 'no ZIP64 end record where the locator points');
        disk = rec.getUint32(16, true); cdDisk = rec.getUint32(20, true);
        onDisk = u64(rec, 24); count = u64(rec, 32); cdSize = u64(rec, 40); cdStart = u64(rec, 48);
      }
    }
    if (!zip64 && (count === MAX16 || cdSize === MAX32 || cdStart === MAX32)) throw fail('truncated', 'ZIP64 values without a ZIP64 record');
    if (disk !== 0 || cdDisk !== 0 || onDisk !== count) throw fail('unsupported', 'a multi-disk archive');
    if (count > maxEntries) throw fail('unsupported', count + ' entries (the limit is ' + maxEntries + ')');
    if (cdSize > MAX_DIRECTORY) throw fail('unsupported', 'the central directory is too large');
    if (cdStart + cdSize !== recordAt) throw fail('truncated', 'the central directory does not end at the end record');
    const cd = await readExact(read, cdStart, cdSize);
    const entries = readDirectory(cd, count, cdStart);
    return { entries, zip64, cdStart };
  }

  async function looksZip(read) {
    try {
      const head = await read(0, 4);
      return !!head && head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && (head[2] === 3 || head[2] === 5) && (head[3] === 4 || head[3] === 6);
    } catch (err) { return false; }
  }

  function readDirectory(cd, count, cdStart) {
    const v = view(cd);
    const entries = new Map();
    let p = 0;
    for (let k = 0; k < count; k++) {
      if (p + CENTRAL > cd.length || v.getUint32(p, true) !== SIG.central) throw fail('truncated', 'central header ' + k + ' is missing');
      const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true);
      const crc = v.getUint32(p + 16, true);
      let csize = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true);
      const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
      const diskStart = v.getUint16(p + 34, true);
      let localOffset = v.getUint32(p + 42, true);
      const next = p + CENTRAL + nameLen + extraLen + commentLen;
      if (next > cd.length) throw fail('truncated', 'central header ' + k + ' is cut off');
      const nameBytes = cd.subarray(p + CENTRAL, p + CENTRAL + nameLen);
      const name = flags & 0x0800 ? utf8Decode(nameBytes) : latin(nameBytes);
      if (name === null) throw fail('bad-entry', 'an entry name is not UTF-8');
      // ZIP64 extended information: the values whose 32-bit fields are all ones, in this order
      for (let q = p + CENTRAL + nameLen, qEnd = q + extraLen; q + 4 <= qEnd;) {
        const id = v.getUint16(q, true), len = v.getUint16(q + 2, true);
        if (id === 1) {
          let r = q + 4;
          const take = () => { if (r + 8 > q + 4 + len) throw fail('bad-entry', 'short ZIP64 extra field'); const x = u64(v, r); r += 8; return x; };
          if (usize === MAX32) usize = take();
          if (csize === MAX32) csize = take();
          if (localOffset === MAX32) localOffset = take();
        }
        q += 4 + len;
      }
      if (flags & 0x0001 || flags & 0x0040) throw fail('unsupported', name + ' is encrypted');
      if (method !== 0) throw fail('unsupported', name + ' is compressed (method ' + method + ')');
      if (diskStart !== 0) throw fail('unsupported', 'a multi-disk archive');
      if (csize !== usize) throw fail('bad-entry', name + ': stored sizes differ');
      if (badName(name)) throw fail('bad-entry', 'unsafe entry name ' + JSON.stringify(name));
      if (entries.has(name)) throw fail('bad-entry', 'duplicate entry ' + name);
      if (localOffset + LOCAL + usize > cdStart) throw fail('bad-entry', name + ' lies past the central directory');
      entries.set(name, { name, crc, bytes: usize, localOffset, method, limit: cdStart });
      p = next;
    }
    if (p !== cd.length) throw fail('truncated', 'the central directory size does not match its entries');
    return entries;
  }

  function latin(b) { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; }

  // The offset of the entry's data, from its local header (whose name and extra field lengths may differ from the
  // central directory's).
  async function dataStart(read, entry) {
    const h = await readExact(read, entry.localOffset, LOCAL);
    const v = view(h);
    if (v.getUint32(0, true) !== SIG.local) throw fail('bad-entry', 'no local header for ' + entry.name);
    if (v.getUint16(8, true) !== 0) throw fail('unsupported', entry.name + ' is compressed');
    const start = entry.localOffset + LOCAL + v.getUint16(26, true) + v.getUint16(28, true);
    if (typeof entry.limit === 'number' && start + entry.bytes > entry.limit) throw fail('bad-entry', entry.name + ' runs into the directory');
    return start;
  }

  return { openZip, dataStart, ZipReadError, badName, utf8Decode, SIG, TAIL };
});
