/* 文字PVメーカー v2 — original work. The .mojipv project package: layout, manifest checks and the read plan (DESIGN_2_1 §12.2–§12.4, §12.6). */
MV.def('export/package', ['core/doc', 'core/media', 'export/zip'], (D, MEDIA, Z) => {
  'use strict';

  // A .mojipv is a store-only ZIP (FROZEN, §12.2):
  //   mimetype        "application/vnd.mojipv+zip", the first entry, stored, no extra field (its text is at offset 38)
  //   manifest.json   { format: 'mojipv.package', v: 1, app, project: 'project.json', files: [...], missing: [...] }
  //   media/<id>.<ext>    one per doc.media entry whose bytes are on this device, in library order
  //   song/<sha1>.<ext>   the song, when doc.song is set and its bytes are on this device
  //   thumbs/<id>.webp    the posters of the included media (optional)
  //   project.json    serialize({ doc, side }): exactly the light save's text, and the last entry
  // This module is pure: ui/project_io collects the blobs, writes the ZIP (export/zip addBlob) and reads it back
  // (export/unzip), and this module decides names, order and what a valid manifest is.

  const PACKAGE_V = 1;
  const MIME = 'application/vnd.mojipv+zip';
  const EXT = '.mojipv';
  const FORMAT = 'mojipv.package';
  const PROJECT = 'project.json';
  const MANIFEST = 'manifest.json';
  const MIMETYPE = 'mimetype';
  const LIMITS = Object.freeze({ entries: 1000, manifest: 1024 * 1024, project: 32 * 1024 * 1024 });
  const ROLES = Object.freeze(['media', 'song', 'thumb']);
  const SHA1 = /^[0-9a-f]{40}$/;

  const EXTS = Object.freeze({
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/x-m4v': 'm4v', 'video/webm': 'webm', 'video/x-matroska': 'mkv',
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/vnd.wave': 'wav',
    'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/flac': 'flac', 'audio/x-flac': 'flac',
    'audio/opus': 'opus', 'audio/webm': 'webm',
  });
  const MEDIA_EXTS = Object.freeze(['png', 'jpg', 'webp', 'avif', 'gif', 'mp4', 'mov', 'm4v', 'webm', 'mkv']);
  const SONG_EXTS = Object.freeze(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'webm', 'mp4', 'mov', 'm4v', 'mkv', 'bin']);

  // extOf(mime) → the file extension for a (sniffed) mime type; 'bin' for anything else.
  function extOf(mime) {
    const base = typeof mime === 'string' ? mime.split(';')[0].trim().toLowerCase() : '';
    return EXTS[base] || 'bin';
  }

  // pathOf(role, key, mime) → 'media/<id>.<ext>' | 'song/<sha1>.<ext>' | 'thumbs/<id>.webp'
  function pathOf(role, key, mime) {
    if (role === 'thumb') return 'thumbs/' + key + '.webp';
    return (role === 'song' ? 'song/' : 'media/') + key + '.' + extOf(mime);
  }

  function textBytes(text) { return Z.utf8(text); }

  // layout(doc, side, have) → { manifest, manifestText, projectText, order, missing, bytes }
  //   have = { media: Map<id, { bytes, crc, mime }>, song: { sha1, bytes, crc, mime } | null, thumbs: Map<id, { bytes, crc }> }
  //   order = every entry in the FROZEN order: [{ name, role: 'mimetype' | 'manifest' | 'media' | 'song' | 'thumb' |
  //           'project', id?, sha1?, bytes, crc, mime?, text? }]; entries with `text` are written with zip.add, the
  //           others with zip.addBlob and the blob the caller holds for that id.
  //   bytes = the exact size of the package file.
  function layout(doc, side, have) {
    const h = have || {};
    const haveMedia = h.media instanceof Map ? h.media : new Map();
    const haveThumbs = h.thumbs instanceof Map ? h.thumbs : new Map();
    const files = [], missing = [], thumbs = [];
    const list = doc && doc.media && Array.isArray(doc.media.list) ? doc.media.list : [];
    for (const entry of list) {
      if (!entry || !MEDIA.isId(entry.id)) continue;
      const got = haveMedia.get(entry.id);
      if (!got) { missing.push(entry.id); continue; }
      const mime = got.mime || entry.mime;
      files.push({ path: pathOf('media', entry.id, mime), role: 'media', id: entry.id, bytes: got.bytes, crc: got.crc >>> 0, mime });
      const th = haveThumbs.get(entry.id);
      if (th) thumbs.push({ path: pathOf('thumb', entry.id), role: 'thumb', id: entry.id, bytes: th.bytes, crc: th.crc >>> 0 });
    }
    const song = doc && doc.song;
    if (song && h.song && h.song.sha1 === song.sha1 && SHA1.test(song.sha1)) {
      files.push({ path: pathOf('song', song.sha1, h.song.mime), role: 'song', sha1: song.sha1, bytes: h.song.bytes, crc: h.song.crc >>> 0,
        mime: h.song.mime || 'application/octet-stream' });
    }
    files.push(...thumbs);
    const manifest = { format: FORMAT, v: PACKAGE_V, app: (doc && doc.meta && doc.meta.app) || '2.1.0', project: PROJECT, files, missing };
    const manifestText = JSON.stringify(manifest);
    const projectText = D.serialize({ doc, side });
    const order = [
      { name: MIMETYPE, role: 'mimetype', text: MIME },
      { name: MANIFEST, role: 'manifest', text: manifestText },
      ...files.map((f) => Object.assign({ name: f.path }, f)),
      { name: PROJECT, role: 'project', text: projectText },
    ];
    for (const o of order) {
      delete o.path;
      if (o.text !== undefined) { const b = textBytes(o.text); o.bytes = b.length; o.crc = Z.crc32(b); }
    }
    return { manifest, manifestText, projectText, order, missing, bytes: archiveSize(order) };
  }

  // The size of a store-only archive holding `order` (export/zip's layout: ZIP64 fields where the writer puts them).
  function archiveSize(order) {
    let offset = 0, directory = 0;
    for (const o of order) {
      const name = Z.utf8(o.name).length;
      const big = o.bytes >= 0xffffffff;
      const far = offset >= 0xffffffff;
      offset += 30 + name + (big ? 20 : 0) + o.bytes;
      directory += 46 + name + ((big ? 2 : 0) + (far ? 1 : 0) ? 4 + 8 * ((big ? 2 : 0) + (far ? 1 : 0)) : 0);
    }
    const zip64 = order.length >= 0xffff || offset >= 0xffffffff || directory >= 0xffffffff;
    return offset + directory + (zip64 ? 56 + 20 : 0) + 22;
  }

  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  // The first entry (local offset 0) is `mimetype`, stored, holding exactly MIME (its CRC and size say so; the reader
  // also sniffs the first 64 bytes). null when it is.
  function mimetypeProblem(entries) {
    let first = null;
    for (const e of entries.values()) if (e.localOffset === 0) first = e;
    if (!first || first.name !== MIMETYPE) return 'the first entry is not mimetype';
    const b = textBytes(MIME);
    if (first.bytes !== b.length || first.crc !== Z.crc32(b) || first.method !== 0) return 'mimetype does not hold ' + MIME;
    return null;
  }

  // manifestProblems(json, entries) → ['code: detail', …] ([] when valid). Codes: 'newer' (a newer package version:
  // pkg.err.newer), and 'format', 'project', 'files', 'path', 'role', 'size', 'missing' (pkg.err.invalid).
  function manifestProblems(json, entries) {
    const out = [];
    const bad = (code, detail) => out.push(code + ': ' + detail);
    if (!isObject(json)) return ['format: the manifest is not an object'];
    if (json.format !== FORMAT) bad('format', 'format must be ' + FORMAT);
    if (!Number.isInteger(json.v) || json.v < 1) bad('format', 'v must be an integer ≥ 1');
    else if (json.v > PACKAGE_V) bad('newer', 'package version ' + json.v + ' (this app reads ' + PACKAGE_V + ')');
    if (json.project !== PROJECT) bad('project', 'project must be ' + PROJECT);
    else if (!entries.has(PROJECT)) bad('project', PROJECT + ' is not in the archive');
    else if (entries.get(PROJECT).bytes > LIMITS.project) bad('size', PROJECT + ' is larger than 32 MB');
    if (entries.has(MANIFEST) && entries.get(MANIFEST).bytes > LIMITS.manifest) bad('size', MANIFEST + ' is larger than 1 MB');
    if (!Array.isArray(json.files)) bad('files', 'files must be an array');
    const seen = new Set();
    let songs = 0, lastOffset = -1;
    for (const [k, f] of (Array.isArray(json.files) ? json.files : []).entries()) {
      const at = 'files[' + k + ']';
      if (!isObject(f)) { bad('files', at + ' must be an object'); continue; }
      if (!ROLES.includes(f.role)) { bad('role', at + '.role must be media, song or thumb'); continue; }
      const p = f.path;
      if (typeof p !== 'string' || seen.has(p)) { bad('path', at + '.path is missing or repeated'); continue; }
      seen.add(p);
      if (!pathMatches(f)) { bad('path', at + '.path ' + JSON.stringify(p) + ' does not match its role'); continue; }
      if (f.role === 'song' && ++songs > 1) bad('role', 'more than one song');
      const e = entries.get(p);
      if (!e) { bad('files', at + ': ' + p + ' is not in the archive'); continue; }
      if (f.bytes !== e.bytes || (f.crc >>> 0) !== e.crc || !Number.isInteger(f.crc)) bad('size', at + ': bytes and crc must equal the directory\'s');
      if (e.localOffset <= lastOffset) bad('files', at + ': files must be in file order');
      lastOffset = e.localOffset;
    }
    if (!Array.isArray(json.missing) || !json.missing.every((id) => MEDIA.isId(id)) || new Set(json.missing).size !== json.missing.length) {
      bad('missing', 'missing must list unique asset ids');
    }
    if (entries.size > LIMITS.entries) bad('files', 'more than ' + LIMITS.entries + ' entries');
    if (entries.has(PROJECT) && lastOffset >= entries.get(PROJECT).localOffset) bad('files', PROJECT + ' must come after every asset');
    return out;
  }

  function pathMatches(f) {
    const p = f.path;
    if (f.role === 'thumb') return MEDIA.isId(f.id) && p === 'thumbs/' + f.id + '.webp';
    const dot = p.lastIndexOf('.');
    const ext = dot > 0 ? p.slice(dot + 1) : '';
    if (f.role === 'media') {
      return MEDIA.isId(f.id) && p === 'media/' + f.id + '.' + ext && MEDIA_EXTS.includes(ext) && typeof f.mime === 'string'
        && extOf(f.mime) === ext;
    }
    return typeof f.sha1 === 'string' && SHA1.test(f.sha1) && p === 'song/' + f.sha1 + '.' + ext && SONG_EXTS.includes(ext);
  }

  // readPlan(manifest, entries) → { project: Entry, media: [{ id, entry, mime }], song: { sha1, entry, mime } | null,
  // thumbs: [{ id, entry }] }, in manifest (= file) order. Call it on a manifest without problems.
  function readPlan(manifest, entries) {
    const plan = { project: entries.get(PROJECT) || null, media: [], song: null, thumbs: [], missing: manifest.missing.slice() };
    for (const f of manifest.files) {
      const entry = entries.get(f.path);
      if (f.role === 'media') plan.media.push({ id: f.id, entry, mime: f.mime });
      else if (f.role === 'song') plan.song = { sha1: f.sha1, entry, mime: f.mime || 'application/octet-stream' };
      else plan.thumbs.push({ id: f.id, entry });
    }
    return plan;
  }

  return { PACKAGE_V, MIME, EXT, FORMAT, PROJECT, MANIFEST, MIMETYPE, LIMITS, ROLES, EXTS, extOf, pathOf, layout, archiveSize,
    mimetypeProblem, manifestProblems, readPlan };
});
