/* 文字PVメーカー v2 — original work. Writes an EXIF orientation into a JPEG, for the import tests (DESIGN_2_1 §11.8.1). */
// Works in Node (module.exports) and in a browser page (window.MVExif). A canvas-made JPEG has no EXIF; this inserts a
// minimal APP1 "Exif" segment right after SOI whose IFD0 holds one tag, Orientation (0x0112), so the browser's decoder
// must turn the image upright (orientation 6: the stored image is shown turned 90° clockwise).
(function (G) {
  'use strict';

  // The APP1 segment: FF E1, length, "Exif\0\0", a big-endian TIFF header, IFD0 with one SHORT entry, no next IFD.
  function app1(orientation) {
    const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8,            // "MM", 42, IFD0 at offset 8
      0, 1,                                                      // one entry
      0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation & 255, 0, 0,  // Orientation, SHORT, count 1, value (left-justified)
      0, 0, 0, 0];                                               // no next IFD
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];        // "Exif\0\0"
    const len = body.length + 2;
    return [0xff, 0xe1, (len >> 8) & 255, len & 255, ...body];
  }

  // withOrientation(jpeg, orientation) → a new Uint8Array: the JPEG with the APP1 segment after SOI (any Exif APP1 it had
  // is dropped).
  function withOrientation(jpeg, orientation) {
    const b = jpeg instanceof Uint8Array ? jpeg : new Uint8Array(jpeg);
    if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error('exif_write: not a JPEG');
    const parts = [b.subarray(0, 2), Uint8Array.from(app1(orientation))];
    let p = 2;
    while (p + 4 <= b.length && b[p] === 0xff && b[p + 1] >= 0xe0 && b[p + 1] <= 0xef) {   // APPn segments
      const len = (b[p + 2] << 8) | b[p + 3];
      const isExif = b[p + 1] === 0xe1 && String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]) === 'Exif';
      if (!isExif) parts.push(b.subarray(p, p + 2 + len));
      p += 2 + len;
    }
    parts.push(b.subarray(p));
    const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
    let at = 0;
    for (const x of parts) { out.set(x, at); at += x.length; }
    return out;
  }

  // readOrientation(jpeg) → the Orientation value of an Exif APP1, or null.
  function readOrientation(jpeg) {
    const b = jpeg instanceof Uint8Array ? jpeg : new Uint8Array(jpeg);
    for (let p = 2; p + 4 <= b.length && b[p] === 0xff;) {
      const m = b[p + 1], len = (b[p + 2] << 8) | b[p + 3];
      if (m === 0xe1 && String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]) === 'Exif') {
        const t = p + 10, le = b[t] === 0x49;
        const u16 = (q) => (le ? b[q] | (b[q + 1] << 8) : (b[q] << 8) | b[q + 1]);
        const u32 = (q) => (le ? (b[q] | (b[q + 1] << 8) | (b[q + 2] << 16) | (b[q + 3] << 24)) >>> 0 : ((b[q] << 24) | (b[q + 1] << 16) | (b[q + 2] << 8) | b[q + 3]) >>> 0);
        const ifd = t + u32(t + 4);
        for (let k = 0, n = u16(ifd); k < n; k++) {
          const e = ifd + 2 + 12 * k;
          if (u16(e) === 0x0112) return u16(e + 8);
        }
        return null;
      }
      if (m === 0xda) break;
      p += 2 + len;
    }
    return null;
  }

  const api = { withOrientation, readOrientation, app1 };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else G.MVExif = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
