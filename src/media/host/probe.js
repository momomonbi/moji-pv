/* 文字PVメーカー v2 — original work. Importing a photo or video: sniff, hash, probe, posters and filmstrips, storage (DESIGN_2_1 §11.4.13, §11.2.7). */
MV.def('media/host/probe', ['core/media', 'core/sha256', 'export/zip', 'media/sniff', 'media/isobmff', 'media/matroska',
  'media/samples', 'media/host/session'], (MEDIA, SHA, Z, SN, ISO, MKV, SM, SES) => {
  'use strict';

  // importFile(file, { name, signal, onProgress, store, idle, canvas }) → Promise<{ entry, fresh, notes }>
  //   store: the device store of ui/project_io = { hasMedia(id), putMedia(id, rec) → { stored, reason }, getIndex(id),
  //          putIndex(id, rec), putThumbs(id, rec) } (every call may fail; the import still returns the entry)
  //   fresh: false when the bytes were already stored under this id (nothing is stored again)
  //   notes: 'animFirstFrame' (no ImageDecoder: the first frame only), 'alphaIgnored' (an alpha video above 1080p plays
  //          opaque), 'bigFile' (over 1 GB), 'quota' / 'memoryOnly' (the bytes stay in memory for this session)
  //   errors: MediaError with the §11.7.9 codes: type, heic, codec, noWebCodecs, tooBig, tooLarge, tooLong, animTooBig,
  //           broken, svg; plus container (§11.4.3: laced video blocks), tooBigVideo (over 4 GB), tooFast (over 120 fps)
  //           and audioOnly (a file with sound only: ui/project_io routes it to the song).
  // indexOf(blob, { sniffed?, onProgress? }) → { table, track, audio } rebuilds a video's mediaIndex record.
  // posterOf(id, { store, canvas? }) / stripOf(id, { store }) → Promise<ImageBitmap | null> from the thumbs store, made
  // again (and stored) when missing.

  const MB = 1024 * 1024;
  const SLICE = 8 * MB;                   // hashing slice
  const SUBTLE_MAX = 256 * MB;            // up to this size crypto.subtle hashes the file in one buffer
  const POSTER = 320;                     // poster long side (px)
  const STRIP = 12, TILE = 160;           // filmstrip: 12 tiles of 160 px on the long side
  const THUMB_V = 1;
  const JPEG_SCAN = 16 * MB;              // a JPEG's frame header (SOFn) is looked for this far into the file at most
  const L = MEDIA.LIMITS;

  const err = (code, message, detail) => new SM.MediaError(code, message || code, detail);

  function checkAbort(signal) {
    if (signal && signal.aborted) { const e = new Error('import cancelled'); e.name = 'AbortError'; throw e; }
  }

  function blobReader(blob) {
    return async (at, n) => new Uint8Array(await blob.slice(at, at + n).arrayBuffer());
  }

  // SHA-256 and CRC-32 in one pass: crypto.subtle for files up to 256 MB (one buffer), else our streaming SHA-256 over
  // 8 MB slices, so a 4 GB video never sits in memory. Progress goes to onProgress(0..1); `idle` yields between slices.
  async function hashBlob(blob, o) {
    const opts = o || {};
    const subtle = typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function' ? crypto.subtle : null;
    let crc = 0;
    let digest;
    if (subtle && blob.size <= SUBTLE_MAX) {
      const buf = new Uint8Array(await blob.arrayBuffer());
      checkAbort(opts.signal);
      const sha = subtle.digest('SHA-256', buf);
      for (let at = 0; at < buf.length; at += SLICE) {
        crc = Z.crc32(buf.subarray(at, at + SLICE), crc);
        if (opts.onProgress) opts.onProgress(Math.min(1, (at + SLICE) / Math.max(1, buf.length)));
        if (opts.idle) await opts.idle();
        checkAbort(opts.signal);
      }
      digest = new Uint8Array(await sha);
    } else {
      const h = SHA.createSha256();
      for (let at = 0; at < blob.size; at += SLICE) {
        const bytes = new Uint8Array(await blob.slice(at, at + SLICE).arrayBuffer());
        h.update(bytes);
        crc = Z.crc32(bytes, crc);
        if (opts.onProgress) opts.onProgress(Math.min(1, (at + SLICE) / blob.size));
        if (opts.idle) await opts.idle();
        checkAbort(opts.signal);
      }
      digest = h.digest();
    }
    return { id: 'a' + SHA.hex(digest).slice(0, 24), crc: crc >>> 0, sha256: SHA.hex(digest) };
  }

  // --- canvases ----------------------------------------------------------------------------------------------------------

  function surface(canvas, w, h) {
    if (canvas) return canvas.create(w, h, { alpha: true });
    const c = new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
    return { canvas: c, ctx: c.getContext('2d') };
  }

  function fitLong(w, h, long) {
    const k = Math.min(1, long / Math.max(w, h));
    return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
  }

  // Draws `image` (coded orientation) upright into (x, y, W, H): rot is the clockwise turn that displays it.
  function drawUpright(ctx, image, rot, x, y, W, H) {
    ctx.save();
    ctx.translate(x, y);
    if (rot === 90) { ctx.translate(W, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(image, 0, 0, H, W); }
    else if (rot === 180) { ctx.translate(W, H); ctx.rotate(Math.PI); ctx.drawImage(image, 0, 0, W, H); }
    else if (rot === 270) { ctx.translate(0, H); ctx.rotate(-Math.PI / 2); ctx.drawImage(image, 0, 0, H, W); }
    else ctx.drawImage(image, 0, 0, W, H);
    ctx.restore();
  }

  async function toBlob(s, type) {
    const c = s.canvas;
    if (typeof c.convertToBlob === 'function') return c.convertToBlob({ type, quality: 0.8 });
    return new Promise((resolve) => c.toBlob(resolve, type, 0.8));
  }

  async function posterBlob(image, w, h, rot, canvas) {
    const [pw, ph] = fitLong(w, h, POSTER);
    const s = surface(canvas, pw, ph);
    s.ctx.clearRect(0, 0, pw, ph);
    drawUpright(s.ctx, image, rot || 0, 0, 0, pw, ph);
    return toBlob(s, 'image/webp');
  }

  // A sprite of STRIP tiles side by side, each the displayed frame with its long side TILE. put(k, image) draws tile k
  // from a frame in its coded orientation as soon as it is decoded, so no full-size copy of a frame is kept for the
  // strip (twelve 4K frames would be ≈ 400 MB); blob() encodes the sprite.
  function stripSheet(w, h, rot, canvas) {
    const [tw, th] = fitLong(w, h, TILE);
    const s = surface(canvas, tw * STRIP, th);
    s.ctx.clearRect(0, 0, tw * STRIP, th);
    return {
      put(k, image) { drawUpright(s.ctx, image, rot || 0, k * tw, 0, tw, th); },
      blob() { return toBlob(s, 'image/webp'); },
    };
  }

  // The STRIP indices spread evenly over n items (repeats when n < STRIP).
  function spread(n) { return Array.from({ length: STRIP }, (_, k) => (n <= 1 ? 0 : Math.round((k * (n - 1)) / (STRIP - 1)))); }

  // --- stills ------------------------------------------------------------------------------------------------------------

  // jpegSize(blob, head) → { w, h } | null: the coded size of a JPEG whose frame header comes after the sniffed head
  // (large ICC or XMP segments first). The marker walk of media/sniff goes on through the file one 64-KB read at a
  // time, up to JPEG_SCAN bytes, so the 40 MP check runs on the header before anything is decoded (§11.4.13 step 1).
  async function jpegSize(blob, head) {
    let at = 0, b = head, p = 2;
    for (;;) {
      const r = SN.jpegWalk(b, p);
      if (!r) return null;
      if (r.w !== undefined) return r;
      if (b.length < SN.HEAD || at + r.next >= Math.min(blob.size, JPEG_SCAN)) return null;   // the file or the scan ends
      at += r.next;
      p = 0;
      b = new Uint8Array(await blob.slice(at, at + SN.HEAD).arrayBuffer());
    }
  }

  async function decodeStill(blob, extra) {
    try {
      return await createImageBitmap(blob, Object.assign({ imageOrientation: 'from-image', colorSpaceConversion: 'default' }, extra || {}));
    } catch (e) {
      if (e && e.name === 'TypeError') {
        try { return await createImageBitmap(blob, extra || {}); } catch (e2) { /* refused below */ }
      }
      throw err('broken', 'the image does not decode');
    }
  }

  // true when some pixel of a 64×64 decode is not opaque
  async function hasAlpha(blob, canvas) {
    const bmp = await decodeStill(blob, { resizeWidth: 64, resizeHeight: 64, resizeQuality: 'low', premultiplyAlpha: 'none' });
    const s = surface(canvas, 64, 64);
    s.ctx.clearRect(0, 0, 64, 64);
    s.ctx.drawImage(bmp, 0, 0, 64, 64);
    bmp.close();
    const px = s.ctx.getImageData(0, 0, 64, 64).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 255) return true;
    return false;
  }

  async function probeStill(blob, sniffed, canvas) {
    const bmp = await decodeStill(blob);
    const w = bmp.width, h = bmp.height;
    if (w * h > L.imagePixels) { bmp.close(); throw err('tooBig', 'image larger than 40 MP'); }
    const poster = await posterBlob(bmp, w, h, 0, canvas);
    bmp.close();
    const alpha = sniffed.container === 'jpeg' ? false : await hasAlpha(blob, canvas);
    return { fields: { w, h, dur: null, fps: null, frames: null, rot: 0, alpha, anim: false, audio: false, codec: null, color: 'srgb', hdr: false },
      thumbs: { v: THUMB_V, poster, strip: null, tiles: 0 }, index: null };
  }

  // --- animations (ImageDecoder) ---------------------------------------------------------------------------------------------

  async function probeAnim(blob, sniffed, canvas, notes) {
    if (typeof ImageDecoder === 'undefined') { notes.push('animFirstFrame'); return probeStill(blob, sniffed, canvas); }
    let dec;
    try {
      dec = new ImageDecoder({ data: blob.stream(), type: sniffed.mime });
      await dec.tracks.ready;
      const tr = dec.tracks.selectedTrack;
      if (!tr || !tr.animated) { dec.close(); return probeStill(blob, sniffed, canvas); }
      await dec.completed;
      const n = tr.frameCount;
      if (n > L.animFrames) throw err('animTooBig', n + ' frames');
      const picks = spread(n);
      const cts = [], dur = [];
      let t = 0, w = 0, h = 0, poster = null, sheet = null;
      for (let k = 0; k < n; k++) {
        const r = await dec.decode({ frameIndex: k, completeFramesOnly: true });
        const f = r.image;
        if (k === 0) {
          w = f.displayWidth; h = f.displayHeight;
          if (Math.max(w, h) > L.animLong || w * h > L.imagePixels) { f.close(); throw err('animTooBig', w + '×' + h); }
          poster = await posterBlob(f, w, h, 0, canvas);
          sheet = stripSheet(w, h, 0, canvas);
        }
        const d = f.duration > 0 ? f.duration : 100000;       // µs; an unknown delay plays at 10 fps
        cts.push(t); dur.push(d); t += d;
        for (let j = 0; j < STRIP; j++) if (picks[j] === k) sheet.put(j, f);
        f.close();
      }
      const strip = await sheet.blob();
      const table = SM.build({ timescale: 1e6, cts, dur, key: cts.map(() => 1), off: cts.map(() => 0), size: cts.map(() => 0) });
      const alpha = sniffed.container === 'gif' || sniffed.alphaHint !== false ? await hasAlpha(blob, canvas) : false;
      return { fields: { w, h, dur: table.duration, fps: table.fps, frames: n, rot: 0, alpha, anim: true,
        audio: false, codec: null, color: 'srgb', hdr: false },
      thumbs: { v: THUMB_V, poster, strip, tiles: STRIP },
      index: { v: MEDIA.INDEX_V, table: SM.toData(table), track: { anim: true, mime: sniffed.mime, w, h, rot: 0 } } };
    } catch (e) {
      if (e instanceof SM.MediaError) throw e;
      throw err('broken', 'the animation does not decode: ' + (e && e.message));
    } finally {
      if (dec) { try { dec.close(); } catch (e) { /* closed */ } }
    }
  }

  // animIndexOf(blob, mime) → { table, track } of an animation (every frame's duration; used when the index is missing).
  async function animIndexOf(blob, mime) {
    if (typeof ImageDecoder === 'undefined') throw err('noWebCodecs', 'no ImageDecoder');
    const dec = new ImageDecoder({ data: blob.stream(), type: mime });
    try {
      await dec.tracks.ready;
      await dec.completed;
      const n = dec.tracks.selectedTrack ? dec.tracks.selectedTrack.frameCount : 0;
      if (!(n >= 1)) throw err('broken', 'no frames');
      const cts = [], dur = [];
      let t = 0, w = 0, h = 0;
      for (let k = 0; k < n; k++) {
        const f = (await dec.decode({ frameIndex: k, completeFramesOnly: true })).image;
        if (!k) { w = f.displayWidth; h = f.displayHeight; }
        const d = f.duration > 0 ? f.duration : 100000;
        cts.push(t); dur.push(d); t += d;
        f.close();
      }
      const table = SM.build({ timescale: 1e6, cts, dur, key: cts.map(() => 1), off: cts.map(() => 0), size: cts.map(() => 0) });
      return { table, track: { anim: true, mime, w, h, rot: 0 } };
    } finally {
      try { dec.close(); } catch (e) { /* closed */ }
    }
  }

  // The presentation index each filmstrip tile shows: key frames spread evenly (videos), frames spread evenly (animations).
  function stripPicks(table, anim) {
    if (anim) return spread(table.n);
    const pres = SM.presentationOf(table);
    const keys = [];
    for (let d = 0; d < table.key.length; d++) if (table.key[d] && pres[d] >= 0) keys.push(pres[d]);
    keys.sort((a, b) => a - b);
    return spread(keys.length).map((k) => keys[k]);
  }

  // --- videos ------------------------------------------------------------------------------------------------------------------

  async function demux(blob, sniffed, onProgress) {
    const read = blobReader(blob);
    const mkv = sniffed.container === 'webm' || sniffed.container === 'matroska';
    return mkv ? MKV.parse(read, blob.size, { onProgress }) : ISO.parse(read, blob.size);
  }

  // The mediaIndex track record: everything a session and a rebuilt entry need.
  function trackInfo(track, movie, sniffed, alpha) {
    return { codec: track.codec, fourcc: track.fourcc, description: track.description ? track.description.slice().buffer : null,
      codedW: track.codedW, codedH: track.codedH, w: track.w, h: track.h, rot: track.rot, color: track.color, alpha,
      audio: movie.tracks.some((t) => t.kind === 'audio'), container: sniffed.container, mime: sniffed.mime, anim: false };
  }

  // A session track from the stored index record ({ table: SampleTable, track: TrackInfo }).
  function sessionTrack(table, info) {
    return Object.assign({}, info, { table, description: info.description ? new Uint8Array(info.description) : null });
  }

  async function indexOf(blob, o) {
    const sniffed = (o && o.sniffed) || SN.sniff(new Uint8Array(await blob.slice(0, SN.HEAD).arrayBuffer()));
    const movie = await demux(blob, sniffed, o && o.onProgress);
    const track = movie.tracks.find((t) => t.kind === 'video');
    if (!track) throw err('audioOnly', 'no video track');
    const alpha = track.alpha && track.w * track.h <= L.alphaVideo[0] * L.alphaVideo[1];
    return { table: track.table, track: trackInfo(track, movie, sniffed, alpha), movie };
  }

  // Entry fields of a video (dur and fps are rounded to q3 by MEDIA.normalizeEntry).
  function videoFields(table, info) {
    return { w: info.w, h: info.h, dur: table.duration, fps: table.fps, frames: table.n, rot: info.rot, alpha: !!info.alpha, anim: false,
      audio: !!info.audio, codec: info.codec, color: SM.colorClass(info.color, Math.min(info.w, info.h) >= 720 ? 'bt709' : 'bt601'),
      hdr: SM.isHdr(info.color) };
  }

  async function probeVideo(blob, sniffed, o, notes) {
    if (typeof VideoDecoder === 'undefined') throw err('noWebCodecs', 'no VideoDecoder');
    let got;
    try {
      got = await indexOf(blob, { sniffed, onProgress: o.onProgress });
    } catch (e) {
      if (e instanceof SM.MediaError) throw e;               // broken, container (laced video), audioOnly
      throw err('broken', String(e && e.message));
    }
    const { table, track: info, movie } = got;
    const vt = movie.tracks.find((t) => t.kind === 'video');
    if (vt.alpha && !info.alpha) notes.push('alphaIgnored');
    const long = Math.max(info.codedW, info.codedH);
    if (long > L.videoLong || info.codedW * info.codedH > L.videoPixels) throw err('tooLarge', info.codedW + '×' + info.codedH);
    if (table.duration > L.videoDur) throw err('tooLong', table.duration + ' s');
    if (table.fps > L.videoFps + 0.5) throw err('tooFast', table.fps + ' fps');
    const track = sessionTrack(table, info);
    const config = await SES.supportedConfig(track, 'software');
    if (!config) throw err('codec', 'this browser cannot decode ' + info.codec, { codec: info.codec });
    const session = SES.createVideoSession({ track, read: blobReader(blob), prefer: 'software', alpha: info.alpha, canvas: o.canvas });
    try {
      const first = await session.request(0);
      const poster = await posterBlob(first.image, info.w, info.h, info.rot, o.canvas);
      const picks = stripPicks(table, false);                // 12 key frames spread evenly, for the filmstrip
      const sheet = stripSheet(info.w, info.h, info.rot, o.canvas);
      for (const i of [...new Set(picks)].sort((a, b) => a - b)) {
        const h = await session.request(i);
        picks.forEach((pick, k) => { if (pick === i) sheet.put(k, h.image); });   // drawn now: the session may close it next
        checkAbort(o.signal);
      }
      const strip = await sheet.blob();
      return { fields: videoFields(table, info), thumbs: { v: THUMB_V, poster, strip, tiles: STRIP },
        index: { v: MEDIA.INDEX_V, table: SM.toData(table), track: info } };
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw err('broken', 'the video does not decode: ' + (e && e.message));
    } finally {
      session.close();
    }
  }

  // --- SVG ---------------------------------------------------------------------------------------------------------------------

  // An image-mode SVG runs no script and loads nothing; it is drawn once at 4096 px on the long side and kept as PNG.
  async function rasterizeSvg(blob, o) {
    const url = URL.createObjectURL(blob.type === 'image/svg+xml' ? blob : new Blob([blob], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      try { await img.decode(); } catch (e) { throw err('svg', 'the SVG does not load'); }
      checkAbort(o && o.signal);
      const w0 = img.naturalWidth || 300, h0 = img.naturalHeight || 150;
      const k = 4096 / Math.max(w0, h0);
      const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
      const s = surface(null, w, h);
      s.ctx.drawImage(img, 0, 0, w, h);
      try {
        return await toBlob(s, 'image/png');
      } catch (e) {
        throw err('svg', 'the SVG taints the canvas');
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // --- import ------------------------------------------------------------------------------------------------------------------

  function baseName(name) {
    const s = String(name || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
    const cut = Array.from(s).slice(0, L.nameMax).join('');
    return cut || 'media';
  }

  async function importFile(file, opts) {
    const o = opts || {};
    const notes = [];
    const name = baseName(o.name || file.name);
    let blob = file;
    let head = new Uint8Array(await blob.slice(0, SN.HEAD).arrayBuffer());
    let sniffed = SN.sniff(head);
    if (sniffed.kind === 'svg') {
      blob = await rasterizeSvg(blob, o);
      head = new Uint8Array(await blob.slice(0, SN.HEAD).arrayBuffer());
      sniffed = SN.sniff(head);
    }
    if (sniffed.kind === 'heic') throw err('heic', 'HEIC');
    if (sniffed.kind === 'audio') throw err('audioOnly', 'a sound file');
    if (sniffed.kind !== 'image' && sniffed.kind !== 'video') throw err('type', 'unknown file type');
    if (sniffed.kind === 'image') {
      if (blob.size > L.imageBytes) throw err('tooBig', 'image file over 60 MB');
      if (sniffed.container === 'jpeg' && sniffed.w === undefined) {
        const size = await jpegSize(blob, head);
        if (!size) throw err('broken', 'no JPEG frame header');
        sniffed.w = size.w; sniffed.h = size.h;
      }
      if (sniffed.w * sniffed.h > L.imagePixels) throw err('tooBig', 'image larger than 40 MP');
      if (sniffed.anim && Math.max(sniffed.w, sniffed.h) > L.animLong) throw err('animTooBig', 'animation larger than 2048 px');
    } else if (blob.size > L.videoBytes) throw err('tooBigVideo', 'video file over 4 GB');
    if (blob.size > L.warnFile) notes.push('bigFile');
    checkAbort(o.signal);
    const progress = (from, span) => (o.onProgress ? (p) => o.onProgress(Math.min(1, from + span * p)) : null);
    const hashed = await hashBlob(blob, { signal: o.signal, onProgress: progress(0, 0.6), idle: o.idle });
    const id = hashed.id;
    const store = o.store || null;
    let fresh = true;
    try { fresh = !(store && await store.hasMedia(id)); } catch (e) { fresh = true; }
    checkAbort(o.signal);
    // Already stored with its index: rebuild the entry from the index (no second scan of a large video).
    let probed = null;
    if (!fresh && sniffed.kind === 'video' && store && store.getIndex) {
      try {
        const rec = await store.getIndex(id);
        const table = rec && rec.v === MEDIA.INDEX_V ? SM.fromData(rec.table) : null;
        if (table && rec.track && !rec.track.anim) probed = { fields: videoFields(table, rec.track), thumbs: null, index: null };
      } catch (e) { probed = null; }
    }
    if (!probed) {
      const sub = { signal: o.signal, onProgress: progress(0.6, 0.3), canvas: o.canvas };
      if (sniffed.kind === 'video') probed = await probeVideo(blob, sniffed, sub, notes);
      else if (sniffed.anim) probed = await probeAnim(blob, sniffed, o.canvas, notes);
      else probed = await probeStill(blob, sniffed, o.canvas);
    }
    checkAbort(o.signal);
    const kind = sniffed.kind === 'video' ? 'video' : 'image';
    const entry = MEDIA.normalizeEntry(Object.assign({ id, kind, name, mime: sniffed.mime, bytes: blob.size }, probed.fields,
      { pv: MEDIA.PROBE_V, pool: false, ai: null }));
    const problems = MEDIA.entryProblems(entry);
    if (problems.length) throw err('broken', 'the file gives an invalid entry: ' + problems.join('; '));
    if (store) {
      if (fresh) {
        let where = null;
        try { where = await store.putMedia(id, { blob, mime: sniffed.mime, bytes: blob.size, crc: hashed.crc, name }); } catch (e) { where = null; }
        if (!where || !where.stored) notes.push(where && where.reason === 'quota' ? 'quota' : 'memoryOnly');
      }
      try {
        if (probed.index && store.putIndex) await store.putIndex(id, probed.index);
        if (probed.thumbs && store.putThumbs) await store.putThumbs(id, probed.thumbs);
      } catch (e) { /* caches: rebuilt on first use */ }
    }
    if (o.onProgress) o.onProgress(1);
    return { entry, fresh, notes, crc: hashed.crc };
  }

  // --- posters and filmstrips (thumbs store; rebuilt when missing) --------------------------------------------------------------

  // thumbsOf(id, { store, canvas }) → the thumbs record ({ v, poster, strip, tiles }), made from the asset and stored when
  // it is missing or partial (a package's poster of a video or an animation, without its filmstrip: ui/project_io).
  async function thumbsOf(id, o) {
    const store = o && o.store;
    if (!store) return null;
    let rec = null;
    try { rec = await store.getThumbs(id); } catch (e) { rec = null; }
    const poster = rec && rec.v === THUMB_V && rec.poster ? rec : null;
    if (poster && !poster.partial) return poster;
    const media = await store.getMedia(id);
    if (!media || !media.blob) return poster;
    const sniffed = SN.sniff(new Uint8Array(await media.blob.slice(0, SN.HEAD).arrayBuffer()));
    let probed;
    try {
      if (sniffed.kind === 'video') probed = await probeVideo(media.blob, sniffed, { canvas: o.canvas }, []);
      else if (sniffed.anim) probed = await probeAnim(media.blob, sniffed, o.canvas, []);
      else probed = await probeStill(media.blob, sniffed, o.canvas);
    } catch (e) { return poster; }
    try { await store.putThumbs(id, probed.thumbs); } catch (e) { /* kept in memory by the caller */ }
    return probed.thumbs;
  }

  async function posterOf(id, o) {
    const rec = await thumbsOf(id, o);
    return rec && rec.poster ? createImageBitmap(rec.poster) : null;
  }

  async function stripOf(id, o) {
    const rec = await thumbsOf(id, o);
    return rec && rec.strip ? createImageBitmap(rec.strip) : null;
  }

  return { importFile, rasterizeSvg, posterOf, stripOf, thumbsOf, indexOf, animIndexOf, stripPicks, hashBlob, sessionTrack,
    drawUpright, blobReader, jpegSize, POSTER, STRIP, TILE, THUMB_V, SUBTLE_MAX, SLICE, JPEG_SCAN };
});
