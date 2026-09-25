/* 文字PVメーカー v2 — original work. Browser harness for tests/browser/media_import.py and package_io.py (not shipped). */
// Evaluated in the built app page (index.html?fresh=1&test=1) after tests/helpers/exif_write.js and media_gen.js, so it
// runs under the real CSP with the real ui/project_io (window.__mv.io). Exposes window.__mediaImport(committed) and
// window.__packageIo(opts); both return plain JSON for the Python side to check.
(function () {
  'use strict';
  const a = window.__mv;
  const G = window.MVMediaGen;
  const PR = MV.use('media/host/probe');
  const STORE = MV.use('media/host/store');
  const SM = MV.use('media/samples');
  const Z = MV.use('export/zip');
  const SHA = MV.use('core/sha256');
  const U = MV.use('export/unzip');
  const D = MV.use('core/doc');
  const MEDIA = MV.use('core/media');

  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const toastTexts = () => [...document.querySelectorAll('.toast-text')].map((x) => x.textContent);
  const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
  const shaHex = async (blob) => SHA.hex(new Uint8Array(await crypto.subtle.digest('SHA-256', await bytesOf(blob))));
  const clean = (e) => (e ? Object.fromEntries(Object.entries(e)) : null);

  async function importOne(file, opts) {
    try {
      const r = await PR.importFile(file, Object.assign({ name: file.name, store: a.io.device }, opts || {}));
      return { ok: true, entry: clean(r.entry), fresh: r.fresh, notes: r.notes };
    } catch (e) {
      return { ok: false, code: e && e.code, name: e && e.name, message: String(e && e.message), detail: e && e.detail ? e.detail : null };
    }
  }

  // Everything IndexedDB holds in the three media stores (read with a separate connection).
  async function idbMedia() {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('mojipv-v2'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all = async (store) => {
      const keys = await new Promise((res) => { const q = db.transaction(store).objectStore(store).getAllKeys(); q.onsuccess = () => res(q.result); });
      const vals = await new Promise((res) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result); });
      return keys.map((k, i) => [k, vals[i]]);
    };
    const out = { version: db.version, stores: [...db.objectStoreNames].sort(), media: {}, index: {}, thumbs: {} };
    for (const [k, v] of await all('media')) {
      const bytes = await bytesOf(v.blob);
      out.media[k] = { bytes: v.bytes, size: v.blob.size, crc: v.crc, crcOk: Z.crc32(bytes) === v.crc, mime: v.mime, name: v.name,
        idOk: 'a' + (await shaHex(v.blob)).slice(0, 24) === k };
    }
    for (const [k, v] of await all('mediaIndex')) {
      const t = SM.fromData(v.table);
      out.index[k] = { v: v.v, n: t ? t.n : null, vfr: t ? t.vfr : null, fps: t ? t.fps : null, codec: v.track && v.track.codec, anim: !!(v.track && v.track.anim) };
    }
    for (const [k, v] of await all('thumbs')) {
      const poster = v.poster ? await createImageBitmap(v.poster) : null;
      const strip = v.strip ? await createImageBitmap(v.strip) : null;
      out.thumbs[k] = { v: v.v, poster: poster ? [poster.width, poster.height] : null, strip: strip ? [strip.width, strip.height] : null, tiles: v.tiles };
      if (poster) poster.close();
      if (strip) strip.close();
    }
    db.close();
    return out;
  }

  // A seeded shuffle, so a failing order can be replayed.
  function shuffled(n, seed) {
    const out = Array.from({ length: n }, (_, i) => i);
    let s = seed >>> 0;
    for (let i = n - 1; i > 0; i--) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const j = s % (i + 1); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }

  // Frame exactness through the real AssetStore: ready() then frame() must give exactly frame k, whose code is k. The
  // counter is drawn in the coded orientation, so it is read unrotated; `rot` (how to display it) is checked as given.
  async function exactness(store, id, times, order, fps, rot) {
    const bad = [];
    for (const k of order) {
      const m = fps ? k / fps : times[k];
      await store.ready([{ id, m }]);
      const f = store.frame(id, m, { px: 192, blur: 0, exact: true, thumb: false });
      const code = f ? G.codeOf(f.image, 0) : -2;
      if (!f || !f.exact || f.index !== k || code !== k || f.rot !== rot) bad.push({ k, exact: f && f.exact, index: f && f.index, code, rot: f && f.rot });
    }
    return bad;
  }

  window.__mediaImport = async (committed, opts) => {
    const o = opts || {};
    const out = { gen: {}, committed: {}, routes: {}, exact: {}, h264: await G.h264(), notes: [] };
    const entries = new Map();
    const keep = (name, r) => { out.gen[name] = r; if (r.ok) entries.set(r.entry.id, r.entry); return r; };
    // stills
    const s = await G.stills();
    keep('png', await importOne(new File([s.png], '透明.png', { type: 'image/png' })));
    keep('jpeg', await importOne(new File([s.jpeg], 'photo.jpg', { type: 'image/jpeg' })));
    keep('webp', await importOne(new File([s.webp], 'photo.webp', { type: 'image/webp' })));
    keep('exif6', await importOne(new File([s.exif6], 'turned.jpg', { type: 'image/jpeg' })));
    keep('svg', await importOne(new File([G.SVG], 'logo.svg', { type: 'image/svg+xml' })));
    // videos
    const vids = {
      webm30: { container: 'webm', fps: 30, frames: 45 },
      mp4_25: { container: 'mp4', fps: 25, frames: 50 },
      vfr: { container: 'mp4', vfr: true, frames: 45 },
      rot90: { container: 'mp4', fps: 30, frames: 30, rotation: 90 },
      alpha: { container: 'webm', fps: 30, frames: 30, alpha: true },
      webm60: { container: 'webm', fps: 60, frames: 90 },
    };
    if (out.h264) vids.h264 = { container: 'mp4', fps: 30, frames: 45, codec: out.h264 };
    const made = {};
    for (const [name, spec] of Object.entries(vids)) {
      made[name] = await G.encodeCounter(spec);
      keep(name, await importOne(new File([made[name].bytes], name + (spec.container === 'webm' ? '.webm' : '.mp4'))));
    }
    // committed fixtures (demuxer edge cases and refusals)
    for (const [name, b64] of Object.entries(committed || {})) {
      out.committed[name] = await importOne(new File([fromB64(b64)], name));
      if (out.committed[name].ok) entries.set(out.committed[name].entry.id, out.committed[name].entry);
    }
    // more refusals
    const big = new Uint8Array(64);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x27, 0x10, 0, 0, 0x13, 0x88, 8, 6, 0, 0, 0]);
    out.gen.huge = await importOne(new File([big], 'huge.png'));                   // 10000 × 5000 in the header: 50 MP
    out.gen.junk = await importOne(new File([new Uint8Array(500).fill(7)], 'junk.png'));
    out.gen.cut = await importOne(new File([made.mp4_25.bytes.subarray(0, Math.floor(made.mp4_25.bytes.length / 2))], 'cut.mp4'));
    out.gen.audioOnly = await importOne(new File([fromB64(o.audioOnly)], 'sound.webm'));
    out.gen.wav = await importOne(new File([G.wav(0.5)], 'tone.wav'));
    // routing (ui/project_io.routeFile): the bytes decide
    const route = async (name, bytes, type) => a.io.routeFile(new File([bytes], name, { type: type || '' }));
    out.routes = {
      webmVideo: await route('clip.webm', made.webm30.bytes, 'audio/webm'), webmAudio: await route('song.webm', fromB64(o.audioOnly), 'video/webm'),
      mp4Video: await route('clip.mp4', made.mp4_25.bytes), png: await route('a.png', await bytesOf(s.png)), wav: await route('t.wav', G.wav(0.1)),
      json: await route('p.json', new TextEncoder().encode('{}'), 'application/json'), lrc: await route('l.lrc', new TextEncoder().encode('<svg> x')),
      pkg: await route('p.mojipv', new Uint8Array(10)), gif: await route('anim.gif', committed && committed['anim.gif'] ? fromB64(committed['anim.gif']) : new Uint8Array(0)),
      heic: await route('x.heic', committed && committed['heic.heic'] ? fromB64(committed['heic.heic']) : new Uint8Array(0)),
    };
    // dedupe: the same bytes again
    const before = Object.keys((await idbMedia()).media).length;
    out.dedupe = await importOne(new File([s.png], 'again.png', { type: 'image/png' }));
    out.dedupeStored = Object.keys((await idbMedia()).media).length - before;
    // the IndexedDB round trip
    out.idb = await idbMedia();
    // frame exactness through the AssetStore (hardware-preferring root store and a software export fork)
    const store = STORE.createMediaStore({ blobs: a.io.mediaBlobs, entries: (id) => entries.get(id) || null });
    const fork = store.fork();
    for (const name of ['webm30', 'mp4_25', 'vfr', 'rot90', 'webm60', 'h264']) {
      if (!out.gen[name] || !out.gen[name].ok) continue;
      const id = out.gen[name].entry.id, times = made[name].times, n = times.length, fps = vids[name].vfr ? 0 : vids[name].fps;
      const seq = Array.from({ length: n }, (_, i) => i);
      const t0 = performance.now();
      const rot = vids[name].rotation || 0;
      out.exact[name] = {
        sequential: await exactness(store, id, times, seq, fps, rot),
        random: await exactness(store, id, times, shuffled(n, 7), fps, rot),
        fork: await exactness(fork, id, times, seq, fps, rot),
        ms: Math.round(performance.now() - t0),
      };
    }
    // alpha: the merged frame has the alpha stream's square (128) and is clear elsewhere
    if (out.gen.alpha.ok) {
      const id = out.gen.alpha.entry.id;
      const probes = [];
      for (const k of [0, 7, 29]) {
        await store.ready([{ id, m: k / 30 }]);
        const f = store.frame(id, k / 30, { px: 192, exact: true });
        const c = new OffscreenCanvas(G.W, G.H);
        const ctx = c.getContext('2d');
        ctx.drawImage(f.image, 0, 0, G.W, G.H);
        const px = ctx.getImageData(0, 0, G.W, G.H).data;
        const at = (x, y) => px[4 * (y * G.W + x) + 3];
        probes.push({ k, index: f.index, inside: at(G.squareX(k) + 12, 88), outside: at(100, 20), exact: f.exact });
      }
      out.alphaProbe = probes;
    }
    // stills through the store: the EXIF-6 photo upright (blue at the top-left), a tier decode
    if (out.gen.exif6.ok) {
      const id = out.gen.exif6.entry.id;
      await store.ready([{ id, m: 0, px: 64 }]);
      const f = store.frame(id, 0, { px: 64, exact: true });
      const c = new OffscreenCanvas(32, 64);
      const ctx = c.getContext('2d');
      ctx.drawImage(f.image, 0, 0, 32, 64);
      const p = ctx.getImageData(3, 3, 1, 1).data;
      out.exifPixel = { rgb: [p[0], p[1], p[2]], size: [f.image.width, f.image.height], exact: f.exact };
    }
    // provisional frames: a fresh preview store answers at once (poster or nothing), then the exact frame after 'ready'
    if (out.gen.webm30.ok) {
      const id = out.gen.webm30.entry.id;
      const pv = STORE.createMediaStore({ blobs: a.io.mediaBlobs, entries: (x) => entries.get(x) || null });
      const first = pv.frame(id, 1.0, { px: 192, exact: false });
      let tries = 0, f = first;
      while ((!f || !f.exact) && tries++ < 200) { await new Promise((r) => setTimeout(r, 10)); f = pv.frame(id, 1.0, { px: 192, exact: false }); }
      out.provisional = { first: first ? { exact: first.exact } : null, later: f ? { exact: f.exact, index: f.index, code: G.codeOf(f.image, 0) } : null,
        info: pv.info(id), missing: pv.info('a' + '0'.repeat(24)) };
      await pv.check(['a' + '0'.repeat(24)]);
      out.provisional.missing = pv.info('a' + '0'.repeat(24));
      out.provisional.has = [pv.has(id), pv.has('a' + '0'.repeat(24))];
      pv.dispose();
    }
    // an animation through the store (ImageDecoder frames by index): anim.gif holds a bar that moves 6 px per frame
    const gif = out.committed['anim.gif'];
    if (gif && gif.ok) {
      const id = gif.entry.id;
      const probes = [];
      for (const [m, want] of [[0, 0], [0.15, 1], [0.95, 9], [1.05, 9], [0.5, 5]]) {
        await store.ready([{ id, m }]);
        const f = store.frame(id, m, { px: 64, exact: true });
        const c = new OffscreenCanvas(64, 36);
        const ctx = c.getContext('2d');
        ctx.drawImage(f.image, 0, 0);
        const row = ctx.getImageData(0, 18, 64, 1).data;
        let first = -1;
        for (let x = 0; x < 64; x++) if (row[4 * x] > 200 && first < 0) first = x;
        probes.push({ m, want, index: f.index, exact: f.exact, bar: first });
      }
      out.animProbe = probes;
    }
    // the preview's look-ahead: want() starts decoding without a promise; the frames then come out exact
    if (out.gen.webm30.ok) {
      const id = out.gen.webm30.entry.id;
      const pv = STORE.createMediaStore({ blobs: a.io.mediaBlobs, entries: (x) => entries.get(x) || null });
      await pv.check([id]);
      pv.frame(id, 0.5, { px: 192 });                        // loads the index and opens the session
      let t = 0;
      while (!pv.frame(id, 0.5, { px: 192 }) || !pv.frame(id, 0.5, { px: 192 }).exact) { if (t++ > 300) break; await new Promise((r) => setTimeout(r, 10)); }
      const heldBefore = pv.stats().held;
      pv.want([{ id, m: 16 / 30 }, { id, m: 17 / 30 }]);   // no frame() call until the look-ahead is decoded
      let n = 0;
      while (pv.stats().held < heldBefore + 2 && n++ < 300) await new Promise((r) => setTimeout(r, 10));
      const f16 = pv.frame(id, 16 / 30, { px: 192 });
      const c16 = f16 && f16.exact ? G.codeOf(f16.image, 0) : -1;
      const f17 = pv.frame(id, 17 / 30, { px: 192 });
      out.lookAhead = { k16: c16, k17: f17 && f17.exact ? G.codeOf(f17.image, 0) : -1, heldBefore, held: pv.stats().held };
      pv.dispose();
    }
    out.storeStats = fork.stats();
    fork.dispose();
    store.dispose();
    // the quota fallback: IndexedDB refuses the media put → the bytes stay in memory, and the import says so
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'media') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return put.call(this, value, key);
    };
    let quota;
    try {
      const c = new OffscreenCanvas(40, 40);
      c.getContext('2d').fillRect(0, 0, 13, 17);
      quota = await importOne(new File([await c.convertToBlob({ type: 'image/png' })], 'quota.png', { type: 'image/png' }));
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    out.quota = { result: quota };
    if (quota.ok) {
      const rec = await a.io.getMedia(quota.entry.id);
      out.quota.memory = !!(rec && rec.blob && rec.blob.size === quota.entry.bytes);
      out.quota.has = await a.io.hasMedia(quota.entry.id);
      out.quota.inIdb = quota.entry.id in (await idbMedia()).media;
    }
    // pruning: an asset only this tab touched goes once a new work starts; one in a kept work stays
    const kept = await a.io.importMedia(new File([s.jpeg], 'kept.jpg', { type: 'image/jpeg' }));
    await a.io.flush();
    const c2 = new OffscreenCanvas(30, 30);
    c2.getContext('2d').fillRect(3, 3, 7, 11);
    const loose = await importOne(new File([await c2.convertToBlob({ type: 'image/png' })], 'loose.png', { type: 'image/png' }));
    const beforePrune = await idbMedia();
    await a.io.newWork();
    a.dispatch({ t: 'lyrics.set', text: 'prune' }, { label: ['undo.typing', {}] });
    await a.io.flush();
    const afterPrune = await idbMedia();
    out.prune = {
      keptId: kept ? kept.id : null, looseId: loose.ok ? loose.entry.id : null,
      looseBefore: loose.ok && loose.entry.id in beforePrune.media,
      looseAfter: loose.ok ? [loose.entry.id in afterPrune.media, loose.entry.id in afterPrune.index, loose.entry.id in afterPrune.thumbs] : null,
      keptAfter: kept ? kept.id in afterPrune.media : null,
    };
    // throughput (NOTES figures): hashing with crypto.subtle (≤ 256 MB) and with the streaming SHA-256 (larger files)
    const blob = new Blob([new Uint8Array(64 * 1024 * 1024).fill(3)]);
    let t = performance.now();
    await PR.hashBlob(blob);
    const subtleMs = performance.now() - t;
    const buf = new Uint8Array(await blob.arrayBuffer());
    t = performance.now();
    const h = SHA.createSha256();
    for (let at = 0; at < buf.length; at += 8 * 1024 * 1024) { h.update(buf.subarray(at, at + 8 * 1024 * 1024)); Z.crc32(buf.subarray(at, at + 8 * 1024 * 1024)); }
    h.digest();
    const streamMs = performance.now() - t;
    out.perf = { hashSubtleMBs: Math.round(64000 / subtleMs), hashStreamMBs: Math.round(64000 / streamMs) };
    out.toasts = toastTexts();
    out.errorCodes = { heic: a.t('media.err.heic'), type: a.t('media.err.type', { name: 'x' }) };
    return out;
  };

  // --- the project package ---------------------------------------------------------------------------------------------

  // A File whose slice() calls are counted (to prove that already-stored assets are not read again).
  function countingFile(bytes, name) {
    const f = new File([bytes], name);
    const calls = [];
    const slice = f.slice.bind(f);
    f.slice = (start, end, type) => { calls.push([start || 0, end === undefined ? f.size : end]); return slice(start, end, type); };
    return { file: f, calls };
  }

  async function opfsHandle(name) {
    const root = await navigator.storage.getDirectory();
    return root.getFileHandle(name, { create: true });
  }

  async function waitFor(fn, ms) {
    const until = performance.now() + (ms || 10000);
    while (performance.now() < until) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 25)); }
    return false;
  }

  function flip(bytes, at) { const c = Uint8Array.from(bytes); c[at] ^= 0x55; return c; }

  async function entryRange(bytes, name) {
    const read = async (at, n) => bytes.subarray(at, at + n);
    const z = await U.openZip(read, bytes.length);
    const e = z.entries.get(name);
    const start = await U.dataStart(read, e);
    return { start, end: start + e.bytes, entries: [...z.entries.values()].map((x) => ({ name: x.name, offset: x.localOffset, bytes: x.bytes })) };
  }

  window.__packageIo = async (opts) => {
    const o = opts || {};
    const out = { steps: [], h264: await G.h264() };
    // every toast project_io shows, in order (the toast host keeps only the newest few on screen)
    const said = [];
    const toast = a.toast;
    a.toast = (text, options) => { said.push(String(text)); return toast(text, options); };
    const toastTexts = () => said.slice();
    const step = (what, data) => out.steps.push(Object.assign({ what }, data || {}));
    // a project: lyrics, a PNG with alpha, a 2-s VP9 WebM, a 2-s MP4 (VP9; H.264 when it encodes), a WAV song
    a.dispatch({ t: 'lyrics.set', text: '[ti:往復]\n夜明けの街\nhello world' }, { label: ['undo.paste', {}] });
    const s = await G.stills();
    const webm = await G.encodeCounter({ container: 'webm', fps: 30, frames: 60 });
    const mp4 = await G.encodeCounter({ container: 'mp4', fps: 30, frames: 60, codec: out.h264 || 'vp09.00.10.08' });
    const png = await a.io.importMedia(new File([s.png], '透明.png', { type: 'image/png' }));
    const vw = await a.io.importMedia(new File([webm.bytes], 'counter.webm'));
    const vm = await a.io.importMedia(new File([mp4.bytes], 'counter.mp4'));
    const wavBytes = G.wav(2);
    await a.loadSong(new File([wavBytes], 'tone.wav', { type: 'audio/wav' }));
    await waitFor(() => a.doc.song && a.doc.song.sha1, 20000);
    await a.io.flush();
    const ids = [png, vw, vm].map((e) => e && e.id);
    const song = a.doc.song ? Object.assign({}, a.doc.song) : null;
    const text0 = D.serialize({ doc: a.doc, side: a.store.side });
    const originals = { [png.id]: await bytesOf(s.png), [vw.id]: webm.bytes, [vm.id]: mp4.bytes };
    step('project', { ids, song: song && song.sha1, media: a.doc.media.list.length });
    // save: a memory sink (download) and an OPFS file sink; the same bytes both ways
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
    out.memorySave = await a.io.savePackage(null);
    const handle = await opfsHandle('roundtrip.mojipv');
    out.fileSave = await a.io.savePackage(handle);
    const fileBytes = await bytesOf(await handle.getFile());
    out.fileBytes = fileBytes.length;
    out.fileState = a.io.fileState();
    out.pkgB64Head = btoa(String.fromCharCode(...fileBytes.subarray(0, 64)));
    window.__pkgBytes = fileBytes;
    const range = await entryRange(fileBytes, 'media/' + vm.id + '.mp4');
    out.entries = range.entries;
    // light save → .json (downloaded)
    out.light = await a.io.saveLight(null);
    // clear the device, then open the package
    await a.io.clearDevice();
    out.afterClear = { media: Object.keys((await idbMedia()).media).length, song: !!(await a.io.getSong(song.sha1)) };
    const opened = await a.io.openFiles([new File([fileBytes], 'roundtrip.mojipv')]);
    await a.io.flush();
    const text1 = D.serialize({ doc: a.doc, side: a.store.side });
    out.open = {
      docEqual: text1 === text0, rows: a.doc.sheet.rows.map((r) => r.src),
      restored: await Promise.all(ids.map(async (id) => {
        const rec = await a.io.getMedia(id);
        const same = rec && rec.blob ? (await bytesOf(rec.blob)).every((b, i) => b === originals[id][i]) && rec.blob.size === originals[id].length : false;
        return { id, has: !!rec, same };
      })),
      song: await (async () => { const b = await a.io.getSong(song.sha1); return b ? { size: b.size, same: (await bytesOf(b)).every((x, i) => x === wavBytes[i]) && b.size === wavBytes.length } : null; })(),
      relinked: await waitFor(() => a.bufferSha1 === song.sha1, 20000),
      thumbs: Object.keys((await idbMedia()).thumbs).length,
    };
    out.opened = opened;
    // dedupe: open again; nothing but headers, the manifest and project.json is read
    const counted = countingFile(fileBytes, 'again.mojipv');
    await a.io.openPackage(counted.file);
    out.dedupe = { calls: counted.calls, mediaRanges: [] };
    for (const id of ids) {
      const ext = id === png.id ? 'png' : id === vw.id ? 'webm' : 'mp4';
      out.dedupe.mediaRanges.push(await entryRange(fileBytes, 'media/' + id + '.' + ext).then((r) => [r.start, r.end]));
    }
    out.dedupe.songRange = await entryRange(fileBytes, out.entries.find((e) => e.name.startsWith('song/')).name).then((r) => [r.start, r.end]);
    // corrupt: one byte flipped inside the MP4 entry → the project opens, that asset is missing, the others are fine
    await a.io.clearDevice();
    const corrupt = flip(fileBytes, range.start + Math.floor((range.end - range.start) / 2));
    const t0 = toastTexts().length;
    out.corrupt = { opened: await a.io.openPackage(new File([corrupt], 'corrupt.mojipv')) };
    out.corrupt.toasts = toastTexts().slice(t0);
    out.corrupt.has = await Promise.all(ids.map((id) => a.io.hasMedia(id)));
    out.corrupt.damagedText = a.t('pkg.warn.damaged', { n: 1 });
    out.corrupt.missingText = a.t('media.missingOpen', { n: 1 });
    // truncated → refused, the work stays
    const docBefore = D.serialize({ doc: a.doc, side: a.store.side });
    const t1 = toastTexts().length;
    out.truncated = { opened: await a.io.openPackage(new File([fileBytes.subarray(0, fileBytes.length - 100)], 'cut.mojipv')) };
    out.truncated.toasts = toastTexts().slice(t1);
    out.truncated.same = D.serialize({ doc: a.doc, side: a.store.side }) === docBefore;
    out.truncated.text = a.t('pkg.err.truncated');
    // project.json damaged → refused
    const pj = await entryRange(fileBytes, 'project.json');
    const t2 = toastTexts().length;
    out.badProject = { opened: await a.io.openPackage(new File([flip(fileBytes, pj.start + 5)], 'badproject.mojipv')) };
    out.badProject.toasts = toastTexts().slice(t2);
    out.badProject.same = D.serialize({ doc: a.doc, side: a.store.side }) === docBefore;
    out.badProject.text = a.t('pkg.err.invalid');
    // not a package: a plain ZIP, and random bytes named .mojipv
    const t3 = toastTexts().length;
    const plainZip = [];
    const zz = Z.createZip(async (b) => { plainZip.push(b); });
    await zz.add('hello.txt', new TextEncoder().encode('hi'));
    await zz.finish();
    out.notPackage = { zip: await a.io.openPackage(new File(plainZip, 'plain.mojipv')), junk: await a.io.openPackage(new File([new Uint8Array(100).fill(9)], 'junk.mojipv')) };
    out.notPackage.toasts = toastTexts().slice(t3);
    out.notPackage.texts = [a.t('pkg.err.notPackage'), a.t('pkg.err.truncated')];
    // cancel mid-open: the work is unchanged
    await a.io.clearDevice();
    a.dispatch({ t: 'lyrics.set', text: 'この作品のまま' }, { label: ['undo.paste', {}] });
    const beforeCancel = D.serialize({ doc: a.doc, side: a.store.side });
    const ctl = new AbortController();
    let progressCalls = 0;
    out.cancel = { opened: await a.io.openPackage(new File([fileBytes], 'cancel.mojipv'), { signal: ctl.signal,
      onProgress: (p) => { progressCalls++; if (p.i >= 1) ctl.abort(); } }) };
    out.cancel.same = D.serialize({ doc: a.doc, side: a.store.side }) === beforeCancel;
    out.cancel.progress = progressCalls;
    // old files: a v2.0 .json (schema 1) opens; a v2.1 light .json with its assets on this device links (no missing toast)
    const t4 = toastTexts().length;
    out.old = { v20: await a.io.openFiles([new File([o.schema1], 'v20.json', { type: 'application/json' })]) };
    out.old.v20doc = { schema: D.CURRENT_SCHEMA, rows: a.doc.sheet.rows.length, media: a.doc.media ? a.doc.media.list.length : null };
    await a.io.openPackage(new File([fileBytes], 'restore.mojipv'));
    const lightText = D.serialize({ doc: a.doc, side: a.store.side });
    const t5 = toastTexts().length;
    await a.io.openFiles([new File([lightText], 'light.json', { type: 'application/json' })]);
    out.old.lightToasts = toastTexts().slice(t5);
    out.old.lightLinked = await Promise.all(ids.map((id) => a.io.hasMedia(id)));
    out.old.lightMedia = a.doc.media.list.map((e) => e.id);
    out.old.toasts = toastTexts().slice(t4);
    out.old.missingText = a.t('media.missingOpen', { n: 3 });
    out.toasts = toastTexts();
    a.toast = toast;
    return out;
  };
})();
