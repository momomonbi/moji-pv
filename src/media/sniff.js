/* 文字PVメーカー v2 — original work. File type sniffing from magic bytes, with header dimensions (DESIGN_2_1 §11.3.4, §11.4.13 step 1). */
MV.def('media/sniff', [], () => {
  'use strict';

  // sniff(head) reads the first bytes of a file (up to 64 KB) and never trusts the name or the browser's type:
  //   { kind: 'image' | 'video' | 'audio' | 'svg' | 'heic' | 'package' | 'zip' | 'unknown', container, mime,
  //     w?, h?, anim?, alphaHint? }
  // kind 'video' means "an ISO BMFF or Matroska file": whether it holds a video track is known only after demuxing
  // (media/isobmff, media/matroska), so audio-only MP4 / WebM files are routed by the demuxer (ui/project_io).
  // 'audio' is for files that can only be sound (MP3, WAV, FLAC, Ogg, AAC). 'package' is a .mojipv (§12.2).

  const HEAD = 65536;
  const PACKAGE_MIME = 'application/vnd.mojipv+zip';

  const u16be = (b, p) => (b[p] << 8) | b[p + 1];
  const u16le = (b, p) => b[p] | (b[p + 1] << 8);
  const u32be = (b, p) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
  const u32le = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
  const u24le = (b, p) => b[p] | (b[p + 1] << 8) | (b[p + 2] << 16);
  const ascii = (b, p, n) => { let s = ''; for (let i = 0; i < n && p + i < b.length; i++) s += String.fromCharCode(b[p + i]); return s; };
  const starts = (b, bytes, at = 0) => bytes.every((v, i) => b[at + i] === v);

  function out(kind, container, mime, extra) { return Object.assign({ kind, container, mime }, extra || {}); }

  function sniff(input) {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
    if (b.length < 4) return out('unknown', null, null);
    if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return png(b);
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return jpeg(b);
    if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return gif(b);
    if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return webp(b);
    if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return out('audio', 'wav', 'audio/wav');
    if (ascii(b, 4, 4) === 'ftyp') return isobmff(b);
    if (starts(b, [0x1a, 0x45, 0xdf, 0xa3])) return ebml(b);
    if (ascii(b, 0, 4) === 'PK\x03\x04') return zip(b);
    if (ascii(b, 0, 4) === 'fLaC') return out('audio', 'flac', 'audio/flac');
    if (ascii(b, 0, 4) === 'OggS') return out('audio', 'ogg', 'audio/ogg');
    if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return mpegAudio(b);
    if (looksSvg(b)) return out('svg', 'svg', 'image/svg+xml');
    return out('unknown', null, null);
  }

  // PNG: IHDR size and colour type; an acTL chunk before IDAT makes it an APNG.
  function png(b) {
    const r = out('image', 'png', 'image/png');
    if (ascii(b, 12, 4) === 'IHDR') {
      r.w = u32be(b, 16); r.h = u32be(b, 20);
      const colour = b[25];
      r.alphaHint = colour === 4 || colour === 6;
    }
    r.anim = false;
    for (let p = 8; p + 8 <= b.length;) {
      const len = u32be(b, p), type = ascii(b, p + 4, 4);
      if (type === 'acTL') { r.anim = true; break; }
      if (type === 'tRNS') r.alphaHint = true;
      if (type === 'IDAT' || type === 'IEND') break;
      p += 12 + len;
    }
    return r;
  }

  // JPEG: the first SOFn marker gives the coded size (EXIF orientation is applied later by the decoder).
  function jpeg(b) {
    const r = out('image', 'jpeg', 'image/jpeg', { anim: false, alphaHint: false });
    for (let p = 2; p + 4 <= b.length;) {
      if (b[p] !== 0xff) { p++; continue; }
      const m = b[p + 1];
      if (m === 0xff) { p++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
      if (m === 0xd9 || m === 0xda) break;
      const len = u16be(b, p + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc && p + 9 <= b.length) {
        r.h = u16be(b, p + 5); r.w = u16be(b, p + 7);
        break;
      }
      p += 2 + len;
    }
    return r;
  }

  // GIF: the logical screen size; a NETSCAPE2.0 loop block or a second image descriptor makes it animated.
  function gif(b) {
    const r = out('image', 'gif', 'image/gif', { w: u16le(b, 6), h: u16le(b, 8), anim: false, alphaHint: false });
    let p = 13;
    if (b[10] & 0x80) p += 3 * (1 << ((b[10] & 7) + 1));        // global colour table
    let images = 0;
    while (p < b.length) {
      const block = b[p];
      if (block === 0x21) {                                     // extension
        const label = b[p + 1];
        if (label === 0xff && ascii(b, p + 3, 11) === 'NETSCAPE2.0') r.anim = true;
        if (label === 0xf9 && (b[p + 3] & 1)) r.alphaHint = true; // graphic control: transparent colour
        p += 2;
        while (p < b.length && b[p]) p += b[p] + 1;
        p++;
      } else if (block === 0x2c) {                              // image descriptor
        images++;
        if (images > 1) { r.anim = true; break; }
        const flags = b[p + 9];
        p += 10;
        if (flags & 0x80) p += 3 * (1 << ((flags & 7) + 1));    // local colour table
        p++;                                                    // LZW minimum code size
        while (p < b.length && b[p]) p += b[p] + 1;
        p++;
      } else break;
    }
    return r;
  }

  // WebP: VP8 (lossy), VP8L (lossless) or VP8X (extended: flags for alpha and animation, canvas size).
  function webp(b) {
    const r = out('image', 'webp', 'image/webp', { anim: false, alphaHint: false });
    const chunk = ascii(b, 12, 4);
    if (chunk === 'VP8X') {
      const flags = b[20];
      r.alphaHint = !!(flags & 0x10);
      r.anim = !!(flags & 0x02);
      r.w = u24le(b, 24) + 1; r.h = u24le(b, 27) + 1;
    } else if (chunk === 'VP8L') {
      const bits = u32le(b, 21);
      r.w = (bits & 0x3fff) + 1; r.h = ((bits >>> 14) & 0x3fff) + 1;
      r.alphaHint = !!((bits >>> 28) & 1);
    } else if (chunk === 'VP8 ') {
      r.w = u16le(b, 26) & 0x3fff; r.h = u16le(b, 28) & 0x3fff;
    }
    return r;
  }

  const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);
  const AVIF_BRANDS = new Set(['avif', 'avis']);
  const QT_BRANDS = new Set(['qt  ']);

  // ISO BMFF: the ftyp brands tell AVIF, HEIC and MOV from MP4. AVIF gets its size from 'ispe' when it is in the head.
  function isobmff(b) {
    const size = u32be(b, 0);
    const brands = [ascii(b, 8, 4)];
    for (let p = 16; p + 4 <= Math.min(size, b.length); p += 4) brands.push(ascii(b, p, 4));
    if (brands.some((x) => AVIF_BRANDS.has(x))) {
      const r = out('image', 'avif', 'image/avif', { anim: brands.includes('avis'), alphaHint: false });
      const ispe = findBytes(b, 'ispe');
      if (ispe >= 4 && ispe + 16 <= b.length) { r.w = u32be(b, ispe + 8); r.h = u32be(b, ispe + 12); }
      return r;
    }
    if (brands.some((x) => HEIF_BRANDS.has(x))) return out('heic', 'heif', 'image/heic');
    if (brands.some((x) => QT_BRANDS.has(x))) return out('video', 'mov', 'video/quicktime');
    if (brands[0] === 'M4A ' || brands[0] === 'M4B ') return out('audio', 'mp4', 'audio/mp4');
    if (brands[0] === 'M4V ' || brands[0] === 'M4VH' || brands[0] === 'M4VP') return out('video', 'mp4', 'video/x-m4v');
    return out('video', 'mp4', 'video/mp4');
  }

  function findBytes(b, text) {
    const first = text.charCodeAt(0);
    for (let p = 0; p + text.length <= b.length; p++) {
      if (b[p] === first && ascii(b, p, text.length) === text) return p;
    }
    return -1;
  }

  // EBML: the DocType element (id 0x4282) inside the header tells WebM from Matroska.
  function ebml(b) {
    const at = findBytes(b.subarray(0, Math.min(b.length, 128)), 'B\x82');
    let doc = '';
    if (at >= 0 && at + 2 < b.length) {
      const len = b[at + 2] & 0x7f;                   // DocType is short: a one-byte size (1xxxxxxx)
      if (b[at + 2] & 0x80) doc = ascii(b, at + 3, len).replace(/\0+$/, '');
    }
    if (doc === 'webm') return out('video', 'webm', 'video/webm');
    if (doc === 'matroska') return out('video', 'matroska', 'video/x-matroska');
    return out('unknown', 'ebml', null);
  }

  // A ZIP whose first entry is `mimetype` holding the package mime (§12.2: its text sits at byte offset 38).
  function zip(b) {
    const nameLen = u16le(b, 26), extraLen = u16le(b, 28);
    if (nameLen === 8 && extraLen === 0 && ascii(b, 30, 8) === 'mimetype' && ascii(b, 38, PACKAGE_MIME.length) === PACKAGE_MIME) {
      return out('package', 'zip', PACKAGE_MIME);
    }
    return out('zip', 'zip', 'application/zip');
  }

  // MPEG audio: an ID3 tag or a frame sync (11 set bits). ADTS (AAC) has 12 set bits and layer bits 00.
  function mpegAudio(b) {
    if (ascii(b, 0, 3) !== 'ID3' && (b[1] & 0xf6) === 0xf0) return out('audio', 'aac', 'audio/aac');
    return out('audio', 'mp3', 'audio/mpeg');
  }

  // SVG: '<svg' within the first 1 KB of text (after an optional BOM, an XML declaration, comments or a doctype).
  function looksSvg(b) {
    const text = ascii(b, 0, Math.min(1024, b.length));
    if (/[\u0000-\u0008\u000e-\u001f]/.test(text.replace(/^ï»¿/, ''))) return false;
    return /<svg[\s>]/i.test(text);
  }

  return { HEAD, PACKAGE_MIME, sniff };
});
