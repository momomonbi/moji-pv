/* 文字PVメーカー v2 — original work. MP4 / M4V / MOV / fragmented MP4 demuxer: box headers and sample tables only (DESIGN_2_1 §11.3.4, §11.4.3). */
MV.def('media/isobmff', ['media/samples'], (SM) => {
  'use strict';

  // parse(read, size) → Promise<Movie>, where read(offset, length) → Promise<Uint8Array> reads the file.
  // Movie = { brand, duration, tracks: Track[], warnings: string[] }
  // Track = { id, kind: 'video' | 'audio' | 'other', codec, fourcc, description, codedW, codedH, w, h, rot, timescale,
  //           color, table: SampleTable | null (video only), alpha: false }
  // Only box headers are read at the top level: `moov` and each `moof` are read whole (they hold the tables), and
  // `mdat` payloads are skipped, so sample data is never read. Errors are MediaError('broken').

  const MB = 1024 * 1024;
  const MAX_MOOV = 64 * MB;              // §11.4.3: a larger moov is refused
  const MAX_MOOF = 16 * MB;
  const VIDEO_ENTRIES = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'vp09', 'av01', 'vp08']);
  const CONFIG_BOXES = { avc1: 'avcC', avc3: 'avcC', hvc1: 'hvcC', hev1: 'hvcC', vp09: 'vpcC', av01: 'av1C' };
  const TKHD_ONE = 0x10000, TKHD_MINUS = -0x10000;
  const FRAG_BASE_IS_MOOF = 0x020000;

  const broken = (msg) => new SM.MediaError('broken', 'mp4: ' + msg);

  function type4(b, p) { return String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]); }

  // A view over one box's bytes with big-endian readers.
  function viewOf(bytes) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }

  function u64(v, p) { return v.getUint32(p) * 0x100000000 + v.getUint32(p + 4); }
  function i64(v, p) { return v.getInt32(p) * 0x100000000 + v.getUint32(p + 4); }

  // Child boxes of bytes[start, end): { type, start, body, end }. A box that runs past `end` stops the walk.
  function children(bytes, start, end) {
    const v = viewOf(bytes);
    const out = [];
    for (let p = start; p + 8 <= end;) {
      let size = v.getUint32(p);
      const type = type4(bytes, p + 4);
      let head = 8;
      if (size === 1) {
        if (p + 16 > end) break;
        size = u64(v, p + 8);
        head = 16;
      } else if (size === 0) size = end - p;
      if (size < head || p + size > end) break;
      out.push({ type, start: p, body: p + head, end: p + size });
      p += size;
    }
    return out;
  }

  function child(bytes, box, type) {
    for (const c of children(bytes, box.body, box.end)) if (c.type === type) return c;
    return null;
  }

  function childPath(bytes, box, types) {
    let cur = box;
    for (const t of types) cur = cur && child(bytes, cur, t);
    return cur;
  }

  // --- the top level ------------------------------------------------------------------------------------------------

  async function readExact(read, at, n) {
    const got = await read(at, n);
    if (!got || got.length < n) throw broken('the file ends early (at ' + at + ')');
    return got.length === n ? got : got.subarray(0, n);
  }

  // The top-level boxes: headers only, reading moov, ftyp and moof whole.
  async function topLevel(read, size) {
    const out = { ftyp: null, moov: null, moofs: [] };
    for (let p = 0; p + 8 <= size;) {
      const h = await readExact(read, p, 8);
      let box = viewOf(h).getUint32(0);
      const type = type4(h, 4);
      let head = 8;
      if (box === 1) {
        const big = await readExact(read, p + 8, 8);
        box = u64(viewOf(big), 0);
        head = 16;
      } else if (box === 0) box = size - p;
      if (box < head) throw broken('bad box size at ' + p);
      if (p + box > size) {
        if (type === 'moov' || type === 'moof') throw broken(type + ' is cut off');
        break;                                           // e.g. an mdat cut short: the sample ranges are checked later
      }
      if (type === 'moov') {
        if (box > MAX_MOOV) throw broken('moov larger than 64 MB');
        out.moov = { bytes: await readExact(read, p, box), at: p };
      } else if (type === 'ftyp' && box <= 4096) {
        out.ftyp = await readExact(read, p, box);
      } else if (type === 'moof') {
        if (box > MAX_MOOF) throw broken('moof larger than 16 MB');
        out.moofs.push({ bytes: await readExact(read, p, box), at: p });
      }
      p += box;
    }
    return out;
  }

  // --- sample entries and track headers -----------------------------------------------------------------------------

  // tkhd: track id, and the rotation of its matrix (0 / 90 / 180 / 270; anything else → null).
  function readTkhd(b, box) {
    const v = viewOf(b);
    const version = b[box.body];
    const p = box.body + 4;
    const id = version === 1 ? v.getUint32(p + 16) : v.getUint32(p + 8);
    const m = (version === 1 ? p + 32 : p + 20) + 16;    // after durations, reserved, layer, group, volume, reserved
    const a = v.getInt32(m), bb = v.getInt32(m + 4), c = v.getInt32(m + 12), d = v.getInt32(m + 16);
    let rot = null;
    if (a === TKHD_ONE && bb === 0 && c === 0 && d === TKHD_ONE) rot = 0;
    else if (a === 0 && bb === TKHD_ONE && c === TKHD_MINUS && d === 0) rot = 90;
    else if (a === TKHD_MINUS && bb === 0 && c === 0 && d === TKHD_MINUS) rot = 180;
    else if (a === 0 && bb === TKHD_MINUS && c === TKHD_ONE && d === 0) rot = 270;
    return { id, rot };
  }

  function readMdhd(b, box) {
    const v = viewOf(b);
    const version = b[box.body];
    const p = box.body + 4;
    return version === 1 ? { timescale: v.getUint32(p + 16), duration: u64(v, p + 20) } : { timescale: v.getUint32(p + 8), duration: v.getUint32(p + 12) };
  }

  // colr: 'nclx' (ISO) or 'nclc' (QuickTime) → ColorInfo.
  function readColr(b, box) {
    if (box.end - box.body < 10) return null;
    const v = viewOf(b);
    const kind = type4(b, box.body);
    if (kind !== 'nclx' && kind !== 'nclc') return null;
    const color = { primaries: v.getUint16(box.body + 4), transfer: v.getUint16(box.body + 6), matrix: v.getUint16(box.body + 8), fullRange: null };
    if (kind === 'nclx' && box.end - box.body >= 11) color.fullRange = !!(b[box.body + 10] & 0x80);
    return color;
  }

  // The first sample entry of stsd: its fourcc, coded size, configuration box and colour.
  function readStsd(b, box, handler) {
    const entries = children(b, box.body + 8, box.end);
    if (!entries.length) return null;
    const e = entries[0];
    const out = { fourcc: e.type, codedW: 0, codedH: 0, config: null, color: null };
    if (handler !== 'vide') return out;
    const v = viewOf(b);
    if (e.body + 78 > e.end) return out;
    out.codedW = v.getUint16(e.body + 24);
    out.codedH = v.getUint16(e.body + 26);
    for (const c of children(b, e.body + 78, e.end)) {
      if (c.type === CONFIG_BOXES[e.type]) out.config = b.slice(c.body, c.end);
      else if (c.type === 'colr' && !out.color) out.color = readColr(b, c);
    }
    return out;
  }

  // elst: the first non-empty edit's media_time (initial empty edits are skipped), or null without an edit list.
  function readElst(b, box) {
    const v = viewOf(b);
    const version = b[box.body];
    const count = v.getUint32(box.body + 4);
    const step = version === 1 ? 20 : 12;
    for (let k = 0, p = box.body + 8; k < count && p + step <= box.end; k++, p += step) {
      const mediaTime = version === 1 ? i64(v, p + 8) : v.getInt32(p + 4);
      if (mediaTime !== -1) return mediaTime;
    }
    return null;
  }

  // --- sample tables (moov) -----------------------------------------------------------------------------------------

  // Decode-order samples of a stbl: { dts, cts, dur, key, off, size } as plain arrays in media ticks.
  function readStbl(b, stbl) {
    const v = viewOf(b);
    const box = (t) => child(b, stbl, t);
    const sizes = [];
    const stsz = box('stsz'), stz2 = box('stz2');
    if (stsz) {
      const fixed = v.getUint32(stsz.body + 4), count = v.getUint32(stsz.body + 8);
      if (!fixed && stsz.body + 12 + 4 * count > stsz.end) throw broken('stsz is short');
      for (let k = 0; k < count; k++) sizes.push(fixed || v.getUint32(stsz.body + 12 + 4 * k));
    } else if (stz2) {
      const field = b[stz2.body + 7], count = v.getUint32(stz2.body + 8);
      for (let k = 0; k < count; k++) {
        const p = stz2.body + 12;
        if (field === 16) sizes.push(v.getUint16(p + 2 * k));
        else if (field === 8) sizes.push(b[p + k]);
        else sizes.push(k & 1 ? b[p + (k >> 1)] & 15 : b[p + (k >> 1)] >> 4);
      }
    }
    const n = sizes.length;
    // chunk offsets
    const chunks = [];
    const stco = box('stco'), co64 = box('co64');
    if (stco) { const c = v.getUint32(stco.body + 4); for (let k = 0; k < c; k++) chunks.push(v.getUint32(stco.body + 8 + 4 * k)); }
    else if (co64) { const c = v.getUint32(co64.body + 4); for (let k = 0; k < c; k++) chunks.push(u64(v, co64.body + 8 + 8 * k)); }
    // stsc: samples per chunk → an offset per sample
    const off = new Array(n);
    const stsc = box('stsc');
    if (n && (!stsc || !chunks.length)) throw broken('no chunk table');
    if (n) {
      const runs = [];
      const count = v.getUint32(stsc.body + 4);
      for (let k = 0; k < count; k++) runs.push([v.getUint32(stsc.body + 8 + 12 * k), v.getUint32(stsc.body + 12 + 12 * k)]);
      let s = 0;
      for (let r = 0; r < runs.length && s < n; r++) {
        const firstChunk = runs[r][0], per = runs[r][1];
        const lastChunk = r + 1 < runs.length ? runs[r + 1][0] - 1 : chunks.length;
        for (let c = firstChunk; c <= lastChunk && s < n; c++) {
          if (c - 1 >= chunks.length) throw broken('stsc points past the chunk table');
          let at = chunks[c - 1];
          for (let k = 0; k < per && s < n; k++, s++) { off[s] = at; at += sizes[s]; }
        }
      }
      if (s < n) throw broken('stsc covers ' + s + ' of ' + n + ' samples');
    }
    // stts: durations → decode times
    const dts = new Array(n), dur = new Array(n);
    const stts = box('stts');
    let s = 0, t = 0;
    if (stts) {
      const count = v.getUint32(stts.body + 4);
      for (let k = 0; k < count && s < n; k++) {
        const c = v.getUint32(stts.body + 8 + 8 * k), delta = v.getUint32(stts.body + 12 + 8 * k);
        for (let j = 0; j < c && s < n; j++, s++) { dts[s] = t; dur[s] = delta; t += delta; }
      }
    }
    if (s < n) throw broken('stts covers ' + s + ' of ' + n + ' samples');
    // ctts: composition offsets (signed in version 1, and read signed in version 0 as writers do)
    const cts = dts.slice();
    const ctts = box('ctts');
    if (ctts) {
      const count = v.getUint32(ctts.body + 4);
      s = 0;
      for (let k = 0; k < count && s < n; k++) {
        const c = v.getUint32(ctts.body + 8 + 8 * k), o = v.getInt32(ctts.body + 12 + 8 * k);
        for (let j = 0; j < c && s < n; j++, s++) cts[s] = dts[s] + o;
      }
    }
    // stss: key frames (all samples are key frames without it)
    const stss = box('stss');
    const key = new Array(n).fill(stss ? 0 : 1);
    if (stss) {
      const count = v.getUint32(stss.body + 4);
      for (let k = 0; k < count; k++) {
        const num = v.getUint32(stss.body + 8 + 4 * k);
        if (num >= 1 && num <= n) key[num - 1] = 1;
      }
    }
    return { dts, cts, dur, key, off, size: sizes };
  }

  // --- fragments (moof) ------------------------------------------------------------------------------------------------

  function readTrex(b, mvex) {
    const out = new Map();
    const v = viewOf(b);
    for (const c of children(b, mvex.body, mvex.end)) {
      if (c.type !== 'trex') continue;
      out.set(v.getUint32(c.body + 4), { dur: v.getUint32(c.body + 12), size: v.getUint32(c.body + 16), flags: v.getUint32(c.body + 20) });
    }
    return out;
  }

  const isKeyFlags = (flags) => !(flags & 0x10000);          // sample_is_non_sync_sample clear

  // Appends the samples of every traf of `moof` (at file offset `at`) that belongs to `trackId` to `acc`.
  function readMoof(b, at, trackId, trex, acc) {
    const v = viewOf(b);
    const root = { body: 8, end: b.length };
    for (const traf of children(b, root.body, root.end)) {
      if (traf.type !== 'traf') continue;
      const tfhd = child(b, traf, 'tfhd');
      if (!tfhd || v.getUint32(tfhd.body + 4) !== trackId) continue;
      const tf = v.getUint32(tfhd.body) & 0xffffff;
      const d = trex.get(trackId) || { dur: 0, size: 0, flags: 0 };
      let p = tfhd.body + 8;
      const field = (flag, fallback, bytes = 4) => {        // the optional tfhd fields, in order
        if (!(tf & flag)) return fallback;
        const value = bytes === 8 ? u64(v, p) : v.getUint32(p);
        p += bytes;
        return value;
      };
      let base = field(0x01, null, 8);                          // base_data_offset
      field(0x02, 0);                                           // sample_description_index
      const defDur = field(0x08, d.dur);
      const defSize = field(0x10, d.size);
      const defFlags = field(0x20, d.flags);
      if (base === null) {
        // the moof start, except for a later traf of the same moof without default-base-is-moof: after the previous data
        base = !(tf & FRAG_BASE_IS_MOOF) && acc.lastMoof === at && acc.lastEnd !== null ? acc.lastEnd : at;
      }
      const tfdt = child(b, traf, 'tfdt');
      if (tfdt) acc.time = b[tfdt.body] === 1 ? u64(v, tfdt.body + 4) : v.getUint32(tfdt.body + 4);
      let dataAt = base;
      for (const trun of children(b, traf.body, traf.end)) {
        if (trun.type !== 'trun') continue;
        const rf = v.getUint32(trun.body) & 0xffffff;
        const count = v.getUint32(trun.body + 4);
        let q = trun.body + 8;
        if (rf & 0x01) { dataAt = base + v.getInt32(q); q += 4; }
        let firstFlags = null;
        if (rf & 0x04) { firstFlags = v.getUint32(q); q += 4; }
        const record = 4 * [0x100, 0x200, 0x400, 0x800].filter((f) => rf & f).length;
        if (q + count * record > trun.end) throw broken('trun is short');
        for (let k = 0; k < count; k++) {
          const next = (flag, fallback, signed) => {
            if (!(rf & flag)) return fallback;
            const value = signed ? v.getInt32(q) : v.getUint32(q);
            q += 4;
            return value;
          };
          const sd = next(0x100, defDur);
          const ss = next(0x200, defSize);
          let sf = next(0x400, defFlags);
          if (k === 0 && firstFlags !== null) sf = firstFlags;
          const so = next(0x800, 0, true);                    // composition offset: signed (version 1), read signed always
          acc.dts.push(acc.time); acc.cts.push(acc.time + so); acc.dur.push(sd);
          acc.key.push(isKeyFlags(sf) ? 1 : 0); acc.off.push(dataAt); acc.size.push(ss);
          acc.time += sd;
          dataAt += ss;
        }
      }
      acc.lastEnd = dataAt;
      acc.lastMoof = at;
    }
  }

  // --- the movie --------------------------------------------------------------------------------------------------------

  async function parse(read, size) {
    if (typeof read !== 'function' || !(size > 0)) throw broken('nothing to read');
    const top = await topLevel(read, size);
    if (!top.moov) throw broken('no moov box');
    const b = top.moov.bytes;
    const moov = { body: 8, end: b.length };
    const warnings = [];
    let brand = top.ftyp ? type4(top.ftyp, 8) : '';
    const mvhd = child(b, moov, 'mvhd');
    let duration = 0;
    if (mvhd) {
      const v = viewOf(b);
      const version = b[mvhd.body];
      const scale = version === 1 ? v.getUint32(mvhd.body + 20) : v.getUint32(mvhd.body + 12);
      const dur = version === 1 ? u64(v, mvhd.body + 24) : v.getUint32(mvhd.body + 16);
      if (scale > 0 && dur !== 0xffffffff) duration = dur / scale;
    }
    const mvex = child(b, moov, 'mvex');
    const trex = mvex ? readTrex(b, mvex) : new Map();
    const tracks = [];
    for (const trak of children(b, moov.body, moov.end)) {
      if (trak.type !== 'trak') continue;
      const tkhd = child(b, trak, 'tkhd');
      const mdia = child(b, trak, 'mdia');
      const mdhd = mdia && child(b, mdia, 'mdhd');
      const hdlr = mdia && child(b, mdia, 'hdlr');
      const stbl = mdia && childPath(b, mdia, ['minf', 'stbl']);
      if (!tkhd || !mdhd || !hdlr || !stbl) continue;
      const handler = type4(b, hdlr.body + 8);
      const head = readTkhd(b, tkhd);
      const { timescale } = readMdhd(b, mdhd);
      const stsd = child(b, stbl, 'stsd');
      const entry = stsd ? readStsd(b, stsd, handler) : null;
      const kind = handler === 'vide' ? 'video' : handler === 'soun' ? 'audio' : 'other';
      const track = { id: head.id, kind, codec: entry ? entry.fourcc : '', fourcc: entry ? entry.fourcc : '', description: null,
        codedW: 0, codedH: 0, w: 0, h: 0, rot: 0, timescale, color: null, table: null, alpha: false };
      tracks.push(track);
      if (kind !== 'video' || !entry) continue;
      if (!(timescale > 0)) throw broken('track ' + head.id + ' has no timescale');
      if (head.rot === null) warnings.push('rotation');
      track.rot = head.rot || 0;
      track.codedW = entry.codedW; track.codedH = entry.codedH;
      const swap = track.rot === 90 || track.rot === 270;
      track.w = swap ? entry.codedH : entry.codedW;
      track.h = swap ? entry.codedW : entry.codedH;
      track.color = entry.color;
      track.description = entry.config && entry.fourcc !== 'vp09' && entry.fourcc !== 'vp08' ? entry.config : null;
      track.codec = SM.codecString({ fourcc: entry.fourcc, config: entry.config });
      if (!VIDEO_ENTRIES.has(entry.fourcc)) warnings.push('codec:' + entry.fourcc);
      // samples: the moov tables, then every fragment
      const acc = readStbl(b, stbl);
      if (top.moofs.length) {
        const frag = { dts: acc.dts, cts: acc.cts, dur: acc.dur, key: acc.key, off: acc.off, size: acc.size,
          time: acc.dts.length ? acc.dts[acc.dts.length - 1] + acc.dur[acc.dur.length - 1] : 0, lastEnd: null, lastMoof: null };
        for (const m of top.moofs) readMoof(m.bytes, m.at, head.id, trex, frag);
      }
      if (!acc.size.length) throw broken('track ' + head.id + ' has no samples');
      for (let s = 0; s < acc.size.length; s++) {
        if (!(acc.off[s] >= 0) || acc.off[s] + acc.size[s] > size) throw broken('sample ' + s + ' lies outside the file');
      }
      const elst = childPath(b, trak, ['edts', 'elst']);
      const start = elst ? readElst(b, elst) : null;
      track.table = SM.build({ timescale, cts: acc.cts, dur: acc.dur, key: acc.key, off: acc.off, size: acc.size,
        start: start === null ? undefined : start });
    }
    if (!brand && top.moofs.length) brand = 'iso5';
    return { brand, duration, tracks, warnings };
  }

  return { parse, children, MAX_MOOV };
});
