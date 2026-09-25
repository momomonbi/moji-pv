/* 文字PVメーカー v2 — original work. Browser harness for the saving and opening fixes of the review (NOTES "## Review fixes:
// saving and opening"): evaluated into the built app page after tests/helpers/media_gen.js by tests/browser/package_io.py,
// through the app's own ui/project_io (window.__mv.io). Exposes window.__packageReview() (every check that one page can
// make) and window.__gatedOpen / __gateRelease / __gatedDone (the open that a second tab's autosave runs into); all
// return plain JSON. */
(function () {
  'use strict';
  const a = window.__mv;
  const G = window.MVMediaGen;
  const PR = MV.use('media/host/probe');
  const STORE = MV.use('media/host/store');
  const Z = MV.use('export/zip');
  const U = MV.use('export/unzip');
  const D = MV.use('core/doc');

  const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
  const same = (x, y) => x.length === y.length && x.every((b, i) => b === y[i]);
  const flip = (bytes, at) => { const c = Uint8Array.from(bytes); c[at] ^= 0x55; return c; };
  const text = () => D.serialize({ doc: a.doc, side: a.store.side });

  async function waitFor(fn, ms) {
    const until = performance.now() + (ms || 10000);
    while (performance.now() < until) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 25)); }
    return false;
  }

  async function opfs(name, create) {
    const root = await navigator.storage.getDirectory();
    if (create) { try { await root.removeEntry(name); } catch (e) { /* not there */ } }
    return root.getFileHandle(name, { create: !!create });
  }

  async function fileBytes(name) {
    try { return await bytesOf(await (await opfs(name)).getFile()); } catch (e) { return null; }
  }

  // An entry's data range in package bytes, and its local header's offset.
  async function entryRange(bytes, name) {
    const read = async (at, n) => bytes.subarray(at, at + n);
    const z = await U.openZip(read, bytes.length);
    const e = z.entries.get(name);
    const start = await U.dataStart(read, e);
    return { start, end: start + e.bytes, header: e.localOffset };
  }

  // Every toast shown while fn runs.
  async function toastsOf(fn) {
    const said = [];
    const toast = a.toast;
    a.toast = (t, o) => { said.push(String(t)); return toast(t, o); };
    let value;
    try { value = await fn(); } finally { a.toast = toast; }
    return { value, said };
  }

  // Counts the bytes that reach any file through FileSystemWritableFileStream.write, and can make its n-th call fail.
  function watchWrites() {
    const proto = FileSystemWritableFileStream.prototype;
    const write = proto.write;
    const w = { bytes: 0, calls: 0, failAt: 0 };
    proto.write = function (x) {
      w.calls++;
      if (w.failAt && w.calls === w.failAt) return Promise.reject(new DOMException('The disk is full.', 'QuotaExceededError'));
      const data = x && x.data !== undefined ? x.data : x;
      w.bytes += data instanceof Blob ? data.size : data.byteLength || 0;
      return write.call(this, x);
    };
    w.restore = () => { proto.write = write; };
    return w;
  }

  // The project: lyrics, a PNG, a 2-s VP9 WebM, a WAV song.
  async function project() {
    await a.io.clearDevice();
    a.dispatch({ t: 'lyrics.set', text: '[ti:見直し]\n保存と読み込み\nsecond line' }, { label: ['undo.paste', {}] });
    const s = await G.stills();
    const webm = await G.encodeCounter({ container: 'webm', fps: 30, frames: 60 });
    const png = await a.io.importMedia(new File([s.png], '見直し.png', { type: 'image/png' }));
    const vw = await a.io.importMedia(new File([webm.bytes], 'clip.webm'));
    const wav = G.wav(1.5);
    await a.loadSong(new File([wav], 'tone.wav', { type: 'audio/wav' }));
    await waitFor(() => a.doc.song && a.doc.song.sha1 && a.bufferSha1 === a.doc.song.sha1, 20000);
    await a.io.flush();
    return { png: png.id, webm: vw.id, sha1: a.doc.song.sha1, wav };
  }

  window.__packageReview = async () => {
    const out = {};
    const p = await project();
    out.project = { png: p.png, webm: p.webm, sha1: p.sha1 };

    // --- SO-1 / SEC-1: a cancelled or failed 保存 (Ctrl+S) onto the project file keeps that file -----------------------
    const keep = await opfs('keep.mojipv', true);
    out.firstSave = await a.io.savePackage(keep);
    const kept0 = await fileBytes('keep.mojipv');
    a.dispatch({ t: 'lyrics.set', text: '[ti:見直し]\n書き換えた\nsecond line' }, { label: ['undo.paste', {}] });
    const ctl = new AbortController();
    const cancelled = await a.io.save({ signal: ctl.signal, onProgress: (x) => { if (x > 0) ctl.abort(); } });
    const kept1 = await fileBytes('keep.mojipv');
    const writes = watchWrites();
    writes.failAt = 3;
    let failed;
    try { failed = await toastsOf(() => a.io.save({})); } finally { writes.restore(); }
    const kept2 = await fileBytes('keep.mojipv');
    out.ctrlS = { cancelled, keptAfterCancel: !!kept1 && same(kept1, kept0), failed: failed.value, failedSaid: failed.said,
      keptAfterFailure: !!kept2 && same(kept2, kept0), file: a.io.fileState() && a.io.fileState().name, bytes: kept0 && kept0.length,
      failText: a.t('io.saveFailed') };
    // 名前を付けて保存 cancelled: the dialog's new file goes; an existing file the dialog handed over as it was stays
    const picked = [];
    const pick = (name, create) => { window.showSaveFilePicker = async () => { const h = await opfs(name, create); picked.push(name); return h; }; };
    pick('fresh.mojipv', true);
    const ctl2 = new AbortController();
    out.saveAsCancelled = await a.io.saveAs({ signal: ctl2.signal, onProgress: (x) => { if (x > 0) ctl2.abort(); } });
    out.freshLeft = (await fileBytes('fresh.mojipv')) !== null;
    pick('keep.mojipv', false);
    const ctl3 = new AbortController();
    await a.io.saveAs({ signal: ctl3.signal, onProgress: (x) => { if (x > 0) ctl3.abort(); } });
    const kept3 = await fileBytes('keep.mojipv');
    out.existingPicked = { left: !!kept3 && same(kept3, kept0), picked };
    delete window.showSaveFilePicker;

    // --- SO-9: [中止] acts inside a large asset, and the progress moves within it ------------------------------------------
    const big = new Uint8Array(70 * 1024 * 1024);
    for (let i = 0; i < big.length; i += 4096) big[i] = (i >> 12) & 255;
    const bigBlob = new Blob([big], { type: 'image/png' });
    const pngRec = await a.io.getMedia(p.png);
    await a.io.putMedia(p.png, Object.assign({}, pngRec, { blob: bigBlob, bytes: bigBlob.size, crc: Z.crc32(big) }));
    const w2 = watchWrites();
    const ticks = [];
    const ctl4 = new AbortController();
    let bigCancel;
    try {
      bigCancel = await a.io.save({ signal: ctl4.signal, onProgress: (x) => { ticks.push(x); if (x >= 0.2) ctl4.abort(); } });
    } finally { w2.restore(); }
    const kept4 = await fileBytes('keep.mojipv');
    out.bigCancel = { result: bigCancel, written: w2.bytes, asset: bigBlob.size, ticksBelow: ticks.filter((x) => x > 0 && x < 0.9).length,
      kept: !!kept4 && same(kept4, kept0) };
    // the whole save, in pieces: the entry holds the asset's bytes
    const bigSave = await a.io.savePackage(await opfs('big.mojipv', true));
    const bigFile = await (await opfs('big.mojipv')).getFile();
    const bigBytes = await bytesOf(bigFile);
    const range = await entryRange(bigBytes, 'media/' + p.png + '.png');
    out.bigSave = { kind: bigSave && bigSave.kind, entry: range.end - range.start, asset: big.length,
      same: same(bigBytes.subarray(range.start, range.end), big) };
    await a.io.putMedia(p.png, pngRec);
    (await navigator.storage.getDirectory()).removeEntry('big.mojipv');

    // the package of this project, for the opening checks
    const pkg = await opfs('review.mojipv', true);
    await a.io.savePackage(pkg);
    const bytes = await bytesOf(await pkg.getFile());
    window.__reviewPkg = bytes;
    const light = text();

    // --- SO-2: a .json that 開く refuses does not become the work's file ------------------------------------------------
    const newer = JSON.parse(light);
    newer.schema = 99;
    const newerHandle = await opfs('fromNewerApp.json', true);
    const nw = await newerHandle.createWritable();
    await nw.write(JSON.stringify(newer));
    await nw.close();
    const newerBefore = await fileBytes('fromNewerApp.json');
    const fileBefore = a.io.fileState() && a.io.fileState().name;
    window.showOpenFilePicker = async () => [newerHandle];
    const refused = await toastsOf(() => a.io.open());
    const stateAfter = a.io.fileState();
    await a.io.save({});
    const newerAfter = await fileBytes('fromNewerApp.json');
    const okHandle = await opfs('ok.json', true);
    const ow = await okHandle.createWritable();
    await ow.write(light);
    await ow.close();
    window.showOpenFilePicker = async () => [okHandle];
    await a.io.open();
    const okState = a.io.fileState();
    delete window.showOpenFilePicker;
    out.refusedOpen = { said: refused.said, newerText: a.t('err.file.newer', { name: 'fromNewerApp.json' }), fileBefore,
      fileAfter: stateAfter && stateAfter.name, untouched: !!newerAfter && same(newerAfter, newerBefore),
      okFile: okState && okState.name, okOpened: okState && okState.opened };

    // --- SO-3: a package opened after the light .json (song missing) re-links its song --------------------------------
    await a.io.clearDevice();
    await a.io.openFiles([new File([light], 'light.json', { type: 'application/json' })]);
    const missingFirst = await waitFor(() => a.doc.song && a.songState().state === 'missing', 10000);
    const reopened = await a.io.openPackage(new File([bytes], 'review.mojipv'));
    out.songRelink = { missingFirst, opened: reopened, stored: !!(await a.io.getSong(p.sha1)),
      relinked: await waitFor(() => a.bufferSha1 === p.sha1 && a.songState().state === 'ready', 10000) };

    // --- SO-4: the filmstrip of a video from a package is made on first use ------------------------------------------
    await a.io.clearDevice();
    await a.io.openPackage(new File([bytes], 'review.mojipv'));
    const th0 = await a.io.getThumbs(p.webm);
    const thPng = await a.io.getThumbs(p.png);
    // media/host/probe.thumbsOf and the AssetStore, each on its own (so the app's own requests do not decide it)
    const vidBlob = (await a.io.getMedia(p.webm)).blob;
    const partialRec = { v: PR.THUMB_V, poster: th0 && th0.poster, strip: null, tiles: 0, partial: true };
    let putByProbe = null;
    const fromProbe = await PR.thumbsOf(p.webm, { canvas: a.svc.canvas, store: { getThumbs: async () => partialRec,
      getMedia: async () => ({ blob: vidBlob }), putThumbs: async (k, r) => { putByProbe = r; } } });
    let putByStore = null;
    const entry = a.doc.media.list.find((e) => e.id === p.webm);
    const store = STORE.createMediaStore({ canvas: a.svc.canvas, entries: (id) => (id === p.webm ? entry : null),
      blobs: { get: async () => vidBlob, thumbs: async () => partialRec, putThumbs: async (k, r) => { putByStore = r; },
        index: async () => null, putIndex: async () => {} } });
    store.frame(p.webm, 0, { thumb: true });
    const storeMade = await waitFor(() => !!(putByStore && putByStore.strip), 15000);
    store.dispose();
    const strip = await a.media.strip(p.webm);
    const th1 = await a.io.getThumbs(p.webm);
    out.strip = { partialAfterOpen: !!(th0 && th0.partial && th0.poster && !th0.strip), pngPartial: !!(thPng && thPng.partial),
      probe: !!(fromProbe && fromProbe.strip && fromProbe.tiles > 0 && putByProbe && putByProbe.strip && !putByProbe.partial),
      store: storeMade, app: !!strip, storedAfter: !!(th1 && th1.strip && !th1.partial) };

    // --- SO-6: a full device keeps the package's assets and song for this session, and says so --------------------------
    await a.io.clearDevice();
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (['songs', 'media', 'thumbs', 'mediaIndex'].includes(this.name)) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return put.call(this, value, key);
    };
    let full;
    try { full = await toastsOf(() => a.io.openPackage(new File([bytes], 'full.mojipv'))); } finally { IDBObjectStore.prototype.put = put; }
    out.full = { opened: full.value, said: full.said, quotaText: a.t('media.err.quota'), media: await a.io.hasMedia(p.png),
      song: !!(await a.io.getSong(p.sha1)), relinked: await waitFor(() => a.bufferSha1 === p.sha1 && a.songState().state === 'ready', 10000) };
    // a store that fails for another reason (no usable IndexedDB): the memory notice names what goes when the tab closes
    const noStore = async (file) => {
      IDBObjectStore.prototype.put = function (value, key) {
        if (['songs', 'media', 'thumbs', 'mediaIndex'].includes(this.name)) throw new DOMException('The store cannot be written.', 'UnknownError');
        return put.call(this, value, key);
      };
      try { return await toastsOf(() => a.io.openPackage(file)); } finally { IDBObjectStore.prototype.put = put; }
    };
    await a.io.clearDevice();
    out.full.nodbSaid = (await noStore(new File([bytes], 'nodb.mojipv'))).said;
    out.full.memoryText = a.t('media.warn.memoryOnly');
    out.full.songText = a.t('song.warn.memoryOnly');
    out.full.allText = a.t('media.warn.memoryOnlyAll');
    // the song already on this device: only the photos and videos go
    await a.io.clearDevice();
    await a.io.putSong(p.sha1, new File([p.wav], 'tone.wav', { type: 'audio/wav' }));
    out.full.mediaOnlySaid = (await noStore(new File([bytes], 'mediaonly.mojipv'))).said;
    // a work with a song and no photos or videos: only the song goes, and no notice names photos or videos
    await a.io.clearDevice();
    a.dispatch({ t: 'lyrics.set', text: '[ti:曲だけ]\n曲だけの作品' }, { label: ['undo.paste', {}] });
    await a.loadSong(new File([p.wav], 'tone.wav', { type: 'audio/wav' }));
    await waitFor(() => a.doc.song && a.bufferSha1 === a.doc.song.sha1, 20000);
    const songPkg = await opfs('songonly.mojipv', true);
    await a.io.savePackage(songPkg);
    const songBytes = await bytesOf(await songPkg.getFile());
    await a.io.clearDevice();
    const songOnly = await noStore(new File([songBytes], 'songonly.mojipv'));
    out.full.songOnly = { opened: songOnly.value, said: songOnly.said, media: a.doc.media ? a.doc.media.list.length : 0,
      song: !!(await a.io.getSong(p.sha1)), photoWords: songOnly.said.filter((x) => x.includes('写真・動画')) };
    (await navigator.storage.getDirectory()).removeEntry('songonly.mojipv');

    // --- SO-7: a damaged local header refuses only that asset ------------------------------------------------------
    await a.io.clearDevice();
    const pr = await entryRange(bytes, 'media/' + p.png + '.png');
    const header = await toastsOf(() => a.io.openPackage(new File([flip(bytes, pr.header)], 'header.mojipv')));
    out.header = { opened: header.value, said: header.said, has: [await a.io.hasMedia(p.png), await a.io.hasMedia(p.webm)],
      damagedText: a.t('pkg.warn.damaged', { n: 1 }), truncatedText: a.t('pkg.err.truncated'), rows: a.doc.sheet.rows.length };

    // --- SO-8: a damaged song is named as the song, not as a photo or video ---------------------------------------------
    await a.io.clearDevice();
    const sr = await entryRange(bytes, 'song/' + p.sha1 + '.wav');
    const song = await toastsOf(() => a.io.openPackage(new File([flip(bytes, sr.start + 1000)], 'song.mojipv')));
    out.songDamaged = { opened: song.value, said: song.said, has: [await a.io.hasMedia(p.png), await a.io.hasMedia(p.webm)],
      songText: a.t('pkg.warn.songDamaged'), mediaText: a.t('pkg.warn.damaged', { n: 1 }), stored: !!(await a.io.getSong(p.sha1)) };
    await a.io.clearDevice();
    const songHeader = await toastsOf(() => a.io.openPackage(new File([flip(bytes, sr.header)], 'songheader.mojipv')));
    out.songDamaged.header = { opened: songHeader.value, said: songHeader.said, stored: !!(await a.io.getSong(p.sha1)) };

    // --- SO-5 (this tab): an asset stored and not yet in a work record holds the lock that pruning needs ----------------
    await a.io.clearDevice();
    const held = async () => ((await navigator.locks.query()).held || []).filter((l) => l.name === 'mojipv-assets').map((l) => l.mode);
    const imported = await a.io.importMedia(new File([(await G.stills()).jpeg], 'held.jpg', { type: 'image/jpeg' }));
    const heldBefore = await held();
    await a.io.flush();
    const afterAutosave = await held();
    await a.io.putMedia(imported.id, await a.io.getMedia(imported.id));   // stored again (a relink): its record names it
    out.hold = { before: heldBefore, afterAutosave, namedAgain: await held(), id: imported && imported.id };
    // a hold of another tab (taken here): pruning keeps an asset no work names; without it the asset goes
    let otherRelease;
    await new Promise((granted) => { navigator.locks.request('mojipv-assets', { mode: 'shared' }, () => new Promise((r) => { otherRelease = r; granted(); })); });
    const loose = await PR.importFile(new File([(await G.stills()).webp], 'loose.webp', { type: 'image/webp' }), { name: 'loose.webp', store: a.io.device });
    await a.io.newWork();
    a.dispatch({ t: 'lyrics.set', text: '別の作品' }, { label: ['undo.paste', {}] });
    await a.io.flush();
    const keptWhileHeld = await a.io.hasMedia(loose.entry.id);
    otherRelease();
    await waitFor(async () => (await held()).length === 0, 3000);
    a.dispatch({ t: 'lyrics.set', text: '別の作品\n二行目' }, { label: ['undo.paste', {}] });
    await a.io.flush();
    out.otherHold = { keptWhileHeld, goneAfter: !(await a.io.hasMedia(loose.entry.id)) };
    out.refused = await letGoChecks(p, bytes, light, held);
    (await navigator.storage.getDirectory()).removeEntry('review.mojipv');
    return out;
  };

  // A picture of another size and colour than any other (so its bytes are on no device yet).
  async function picture(w, h, color) {
    const c = new OffscreenCanvas(w, h);
    const x = c.getContext('2d');
    x.fillStyle = color;
    x.fillRect(0, 0, w, h);
    return new File([await c.convertToBlob({ type: 'image/png' })], 'p' + w + 'x' + h + '.png', { type: 'image/png' });
  }

  // The next file picker (ui/dom.pickFiles) gets `file` without a dialog.
  function pickNext(file) {
    const click = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type !== 'file') return click.call(this);
      HTMLInputElement.prototype.click = click;
      const dt = new DataTransfer();
      dt.items.add(file);
      this.files = dt.files;
      this.dispatchEvent(new Event('change'));
      return undefined;
    };
  }

  // --- SO-5: an open, relink, replace or import that ends without the asset it stored lets the lock go ------------------
  async function letGoChecks(p, bytes, light, held) {
    const out = {};
    const free = () => waitFor(async () => (await held()).length === 0, 1500);
    const idOf = async (file) => (await PR.hashBlob(file)).id;
    // a package open cancelled after its first asset is stored, then an autosave
    await a.io.clearDevice();
    a.dispatch({ t: 'lyrics.set', text: '今の作品' }, { label: ['undo.paste', {}] });
    await a.io.flush();
    const ctl = new AbortController();
    const opened = await a.io.openPackage(new File([bytes], 'cancel.mojipv'), { signal: ctl.signal,
      onProgress: (x) => { if (x.i >= 2) ctl.abort(); } });
    out.cancel = { opened, stored: await a.io.hasMedia(p.png), freeAfter: await free() };
    a.dispatch({ t: 'lyrics.set', text: '今の作品\n編集' }, { label: ['undo.paste', {}] });
    await a.io.flush();
    out.cancel.afterAutosave = await held();

    // つなぎ直す with a file that is not the original, in a work whose photo and video are missing
    await a.io.clearDevice();
    await a.io.openFiles([new File([light], 'light.json', { type: 'application/json' })]);
    await a.io.flush();
    out.missing = await waitFor(() => a.media.state(p.png) === 'missing' && a.media.state(p.webm) === 'missing', 10000);
    // for that photo: 置き換える is offered, and the file stays held until the toast is closed
    const wide = await picture(50, 30, '#208040');
    pickNext(wide);
    const n1 = await a.media.relink(p.png);
    const offered = await held();
    const toast = [...document.querySelectorAll('.toast')].find((el) => el.textContent.includes(a.t('media.relinkNone', { name: wide.name })));
    if (toast) toast.querySelector('.toast-x').click();
    out.offered = { n: n1, offered, toast: !!toast, stored: await a.io.hasMedia(await idOf(wide)), freeAfterClose: await free() };
    // a file of the same size, and the question declined
    const confirm = a.confirm;
    let during = null;
    a.confirm = async () => { during = await held(); return false; };
    const same = await picture(96, 64, '#806020');
    pickNext(same);
    let n2;
    try { n2 = await a.media.relink(p.png); } finally { a.confirm = confirm; }
    out.declined = { n: n2, during, stored: await a.io.hasMedia(await idOf(same)), free: await free() };
    // for any missing asset (two of them): nothing to offer
    const other = await picture(40, 30, '#602080');
    pickNext(other);
    const n3 = await a.media.relink();
    out.none = { n: n3, stored: await a.io.hasMedia(await idOf(other)), free: await free() };

    // 置き換える with a file of another kind (a video for a photo)
    await a.io.clearDevice();
    const own = await a.io.importMedia(await picture(48, 48, '#a04020'));
    await a.io.flush();
    const vr = await entryRange(bytes, 'media/' + p.webm + '.webm');
    pickNext(new File([bytes.slice(vr.start, vr.end)], 'clip.webm', { type: 'video/webm' }));
    const replaced = await a.media.replace(own.id);
    out.replaceKind = { replaced, stored: await a.io.hasMedia(p.webm), free: await free() };

    // an import into a full library (200 photos and videos), through the app and through ui/project_io's own import
    const fill = [];
    for (let i = 1; i < 200; i++) {
      fill.push({ t: 'media.put', entry: Object.assign({}, a.doc.media.list[0], { id: 'a' + i.toString(16).padStart(24, '0'), name: 'fill' + i + '.png' }) });
    }
    a.batch({ label: ['undo.media.put', {}] }, fill);
    await a.io.flush();
    const beyond = await picture(52, 30, '#4040c0');
    const viaMedia = await a.media.importFiles([beyond]);
    out.full = { n: a.doc.media.list.length, viaMedia: viaMedia.length, storedMedia: await a.io.hasMedia(await idOf(beyond)), freeMedia: await free() };
    const beyond2 = await picture(54, 30, '#40c040');
    out.full.viaIo = await a.io.importMedia(beyond2);
    out.full.storedIo = await a.io.hasMedia(await idOf(beyond2));
    out.full.freeIo = await free();

    // an import dropped because another work was opened while it was being stored: that load lets it go
    await a.io.clearDevice();
    const real = a.io.device;
    let gateOpen;
    let reached = false;
    const gate = new Promise((r) => { gateOpen = r; });
    a.io.device = Object.freeze(Object.assign({}, real, {
      putMedia: async (id, rec) => { const r = await real.putMedia(id, rec); reached = true; await gate; return r; } }));
    let late;
    try {
      late = a.media.importFiles([await picture(56, 30, '#c0c040')]);
      await waitFor(() => reached, 10000);
      out.dropped = { heldWhileStoring: await held() };
      await a.io.newWork();
      gateOpen();
      out.dropped.entries = (await late).length;
    } finally { a.io.device = real; gateOpen(); }
    out.dropped.inDoc = a.doc.media ? a.doc.media.list.length : 0;
    out.dropped.free = await free();
    await a.io.clearDevice();
    return out;
  }

  // --- SO-5 (two tabs): this tab opens the package, its 2nd asset held on a gate, while the other tab autosaves -----------
  window.__gatedOpen = async () => {
    const bytes = window.__reviewPkg;
    await a.io.clearDevice();
    const read = async (at, n) => bytes.subarray(at, at + n);
    const z = await U.openZip(read, bytes.length);
    const media = [...z.entries.values()].filter((e) => e.name.startsWith('media/'));
    const second = media[1];
    const start = await U.dataStart(read, second);
    const f = new File([bytes], 'two.mojipv');
    const slice = f.slice.bind(f);
    let open;
    window.__gate = new Promise((r) => { open = r; });
    window.__gateRelease = () => open();
    window.__gateReached = false;
    f.slice = (s, e, type) => {
      const b = slice(s, e, type);
      if (s === start && e === start + second.bytes) {
        const buf = b.arrayBuffer.bind(b);
        b.arrayBuffer = async () => { window.__gateReached = true; await window.__gate; return buf(); };
      }
      return b;
    };
    const said = [];
    const toast = a.toast;
    a.toast = (t, o) => { said.push(String(t)); return toast(t, o); };
    const first = media[0].name.slice(6).replace(/\.[^.]+$/, '');
    window.__gatedRun = a.io.openPackage(f).then(async (opened) => {
      a.toast = toast;
      return { opened, said, first, has: await a.io.hasMedia(first), missing: await a.io.missingMedia(a.doc),
        missingText: a.t('media.missingOpen', { n: 1 }) };
    });
    return { first, second: second.name };
  };
  window.__gatedDone = () => window.__gatedRun;
})();
