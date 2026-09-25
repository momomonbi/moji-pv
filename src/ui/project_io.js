/* 文字PVメーカー v2 — original work. Project I/O: new / open / save (the .mojipv package, DESIGN_2_1 §12) / light save / .lrc, autosave to IndexedDB (doc + side, songs by sha1, photos and videos by AssetId), drop routing by sniffing, clearing the device. */
MV.def('ui/project_io', ['ui/dom', 'core/doc', 'core/migrate', 'core/media', 'i18n/t', 'ui/ai_controller',
  'export/package', 'export/unzip', 'export/zip', 'export/host/sink', 'media/sniff', 'media/isobmff', 'media/matroska',
  'media/host/probe', 'export/subtitles'], (dom, D, M, MEDIA, T, AC, PKG, U, Z, SINK, SN, ISO, MKV, PR, SUB) => {
  'use strict';

  const DB_NAME = 'mojipv-v2';
  const DB_VERSION = 2;                 // v2.1: + media, mediaIndex, thumbs (§11.2.7)
  const MEDIA_STORES = ['media', 'mediaIndex', 'thumbs'];
  const RECENT = 5;
  const AUTOSAVE_MS = 1000;
  const LOCK_PREFIX = 'mojipv-work:';   // one Web Lock per open work: two tabs never write the same record
  const LOCK_WAIT_MS = 1500;            // a reloaded page may still see its previous document's lock for a moment
  const LYRIC_EXT = /\.(txt|lrc)$/i;
  const PROJECT_EXT = /\.json$/i;
  const PACKAGE_EXT = /\.mojipv$/i;
  const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|webm)$/i;
  const MB = 1024 * 1024;
  const PKG_BIG = 2 * 1024 * MB;        // §12.3 step 3: a confirmation above 2 GB
  const PKG_MEMORY = 1.5 * 1024 * MB;   // without File System Access, a confirmation above 1.5 GB
  const QUOTA_WARN = 0.8;               // §11.2.7: a warning above 80 % of the quota

  // --- text files: the encoding of a lyric / LRC file ------------------------------------------------------------

  const BOMS = [[[0xEF, 0xBB, 0xBF], 'utf-8'], [[0xFF, 0xFE], 'utf-16le'], [[0xFE, 0xFF], 'utf-16be']];
  const LEGACY = ['shift_jis', 'euc-jp'];                     // Japanese lyric files without a BOM, in this order
  const ENCODING_NAMES = { 'shift_jis': 'Shift_JIS', 'euc-jp': 'EUC-JP' };

  // Half-width katakana and private-use characters: rare in lyrics, common when EUC-JP bytes are read as Shift_JIS.
  function oddChars(s) {
    let n = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if ((c >= 0xFF61 && c <= 0xFF9F) || (c >= 0xE000 && c <= 0xF8FF)) n++;
    }
    return n;
  }

  // decodeText(bytes) → { text, encoding, sure }: a BOM wins (UTF-8, UTF-16 LE/BE); otherwise strict UTF-8, then the
  // legacy Japanese encodings that decode without an error (the one with fewer odd characters). `sure` is false when
  // nothing decoded cleanly and the text is UTF-8 with replacement characters.
  function decodeText(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    for (const [bom, encoding] of BOMS) {
      if (bytes.length >= bom.length && bom.every((b, i) => bytes[i] === b)) {
        return { text: new TextDecoder(encoding).decode(bytes), encoding, sure: true };   // the decoder drops the BOM
      }
    }
    const strict = (encoding) => { try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); } catch (e) { return null; } };
    const utf8 = strict('utf-8');
    if (utf8 !== null) return { text: utf8, encoding: 'utf-8', sure: true };
    let best = null;
    for (const encoding of LEGACY) {
      const text = strict(encoding);
      if (text === null) continue;
      const odd = oddChars(text);
      if (!best || odd < best.odd) best = { text, encoding, odd };
    }
    if (best) return { text: best.text, encoding: best.encoding, sure: true };
    return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8', sure: false };
  }

  // The song sha1s still needed: those of the given work records (their saved JSON text) plus `extra`.
  function songsInUse(texts, extra) {
    const keep = new Set((extra || []).filter((x) => typeof x === 'string' && x));
    for (const text of texts || []) {
      try {
        const song = JSON.parse(text).doc.song;
        if (song && typeof song.sha1 === 'string') keep.add(song.sha1);
      } catch (e) { /* a record that does not parse keeps nothing */ }
    }
    return keep;
  }

  // The asset ids still needed: those in the libraries (doc.media) of the given work records (their saved JSON text)
  // and documents, plus `extra` (§11.2.7 pruning: the newest works, the current document, this tab's usedMedia).
  function mediaInUse(texts, docs, extra) {
    const keep = new Set();
    for (const id of extra || []) if (MEDIA.isId(id)) keep.add(id);
    const add = (doc) => {
      const list = doc && doc.media && Array.isArray(doc.media.list) ? doc.media.list : [];
      for (const e of list) if (e && MEDIA.isId(e.id)) keep.add(e.id);
    };
    for (const text of texts || []) {
      try { add(JSON.parse(text).doc); } catch (e) { /* a record that does not parse keeps nothing */ }
    }
    for (const doc of docs || []) add(doc);
    return keep;
  }

  // routeOf(name, type, sniffed) → 'package' | 'project' | 'lyrics' | 'song' | 'media' | 'container' | 'unknown'.
  // Text formats go by their extension (a lyric may well contain "<svg"); everything else by its bytes (media/sniff),
  // never by the name: a WebM may be a video or a song. 'container' (MP4, MOV, WebM, MKV) is decided by the demuxer:
  // media with a video track, the song without one (§11.7.2).
  function routeOf(name, type, sniffed) {
    const n = String(name || ''), ty = String(type || '');
    if (PACKAGE_EXT.test(n)) return 'package';
    if (PROJECT_EXT.test(n)) return 'project';
    if (LYRIC_EXT.test(n)) return 'lyrics';
    const s = sniffed || { kind: 'unknown' };
    if (s.kind === 'package') return 'package';
    if (s.kind === 'image' || s.kind === 'svg' || s.kind === 'heic') return 'media';
    if (s.kind === 'audio') return 'song';
    if (s.kind === 'video') return 'container';
    if (ty === 'application/json') return 'project';
    if (ty.startsWith('text/')) return 'lyrics';
    if (AUDIO_EXT.test(n) || ty.startsWith('audio/')) return 'song';
    return 'unknown';
  }

  // quotaNote({ usage, quota }) → null, or { share, usage, quota } when the device store is above 80 % of its quota.
  function quotaNote(info) {
    if (!info || !(info.quota > 0) || !(info.usage >= 0)) return null;
    const share = info.usage / info.quota;
    return share > QUOTA_WARN ? { share, usage: info.usage, quota: info.quota } : null;
  }

  // The kind of a package save: photos and videos counted, and whether the song is in it (io.savedWhat).
  function contentsOf(layout) {
    let p = 0, v = 0, song = false;
    for (const o of layout.order) {
      if (o.role === 'media') { if (String(o.mime).startsWith('video/')) v++; else p++; }
      if (o.role === 'song') song = true;
    }
    return { p, v, song };
  }

  // --- IndexedDB (every call tolerates a missing or failing database) ------------------------------------------

  function openDb() {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('works')) db.createObjectStore('works', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs');
        for (const name of MEDIA_STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(db, store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const out = fn(t.objectStore(store));
      t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  function newId() {
    const a = new Uint32Array(2);
    crypto.getRandomValues(a);
    return a[0].toString(36) + a[1].toString(36);
  }

  function lrcTag(s) {
    const cs = Math.max(0, Math.round(s * 100));
    const m = Math.floor(cs / 6000), sec = Math.floor(cs / 100) % 60, c = cs % 100;
    return '[' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + String(c).padStart(2, '0') + ']';
  }

  // window.sessionStorage / localStorage, or null where reading them throws (blocked storage, private mode).
  function storage(name) {
    try { return window[name] || null; } catch (e) { return null; }
  }

  function safeName(s) { return String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 80); }

  function create(app) {
    const t = app.t;
    const tab = newId();                  // this tab's writer token, stored with every record it writes
    let dbp = null;
    let conn = null;                      // the open connection, so a flush on pagehide reaches put() without an await
    let workId = null;
    let held = null;                      // { id, release } of the Web Lock on the current work
    let fileHandle = null;
    let state = 'idle';
    let saved = { id: null, text: null }; // what the database holds, for which work
    let writing = Promise.resolve();      // the newest write (flush() waits for it)
    const used = new Set();               // song sha1s this tab stored or read since the last load (undo can bring them back)
    const usedMedia = new Set();          // asset ids this tab stored or read since the last load (§11.2.7 pruning)
    // The in-memory fallback of the three media stores: without IndexedDB, or when it is full (QuotaExceededError), an
    // asset stays in memory for this session only, and the user is told to save a package (§11.2.7).
    const memory = { media: new Map(), mediaIndex: new Map(), thumbs: new Map() };
    const songCrcs = new Map();           // song sha1 → CRC-32, computed once per session for package saves (§12.3)
    let persistAsked = false;
    let fileSaved = null;                 // { name, at, text } of the last package or light save to a file

    function db() {
      if (!dbp) {
        dbp = typeof indexedDB === 'undefined' ? Promise.reject(new Error('no indexedDB')) : openDb().then((d) => {
          conn = d;
          d.onversionchange = () => { d.close(); conn = null; dbp = null; };
          return d;
        });
      }
      return dbp;
    }

    function setState(s) {
      if (s === state) return;
      state = s;
      app.bus.emit('save', s);
    }

    // --- which work this tab writes (Web Locks, writer token) ------------------------------------------------

    function lockApi() {
      return typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function' ? navigator.locks : null;
    }

    // acquire(id, waitMs) → Promise<release() | null>: holds the work's lock until release() is called; null while
    // another tab holds it (after waiting up to waitMs). Without Web Locks it always succeeds (the writer token guards).
    function acquire(id, waitMs) {
      const locks = lockApi();
      if (!locks) return Promise.resolve(() => {});
      return new Promise((resolve) => {
        let timer = 0;
        let opts = { ifAvailable: true };
        if (waitMs > 0) {
          const ctl = new AbortController();
          timer = setTimeout(() => ctl.abort(), waitMs);
          opts = { signal: ctl.signal };
        }
        locks.request(LOCK_PREFIX + id, opts, (lock) => {
          clearTimeout(timer);
          if (!lock) { resolve(null); return undefined; }
          return new Promise((release) => resolve(release));
        }).catch((e) => {
          clearTimeout(timer);
          resolve(e && e.name === 'AbortError' ? null : () => {});   // aborted: held elsewhere; other errors: no locks
        });
      });
    }

    // setWork(id, release?): the work this tab writes from now on; the previous work's lock is released.
    function setWork(id, release) {
      if (held && held.id !== id) { held.release(); held = null; }
      workId = id;
      if (release) { if (held) held.release(); held = { id, release }; return; }
      if (held) return;
      acquire(id, 0).then((r) => {                          // a fresh id: nobody else can hold it
        if (!r) return;
        if (workId === id && !held) held = { id, release: r }; else r();
      });
    }

    // Marks a record as written by this tab: another tab that still writes it (a browser without Web Locks) then saves
    // its own document as a copy instead of overwriting this one.
    async function claim(d, id) {
      await tx(d, 'works', 'readwrite', (s) => {
        const g = s.get(id);
        g.onsuccess = () => { if (g.result) s.put(Object.assign({}, g.result, { writer: tab })); };
      });
    }

    // --- autosave ------------------------------------------------------------------------------------------

    // One transaction. `direct` (leaving the page) puts at once; otherwise the record is read first and, when another
    // tab has written it since, this tab's document goes to a new record (a copy) instead of overwriting it.
    function putWork(d, job, direct) {
      return new Promise((resolve, reject) => {
        const tr = d.transaction('works', 'readwrite');
        const s = tr.objectStore('works');
        const out = { id: job.id };
        const put = (id) => { out.id = id; s.put({ id, name: job.name, at: Date.now(), text: job.text, writer: tab }); };
        if (direct) {
          put(job.id);
          if (typeof tr.commit === 'function') tr.commit();  // commit now: the page may be gone before auto-commit
        } else {
          const g = s.get(job.id);
          g.onsuccess = () => { const cur = g.result; put(cur && cur.writer && cur.writer !== tab ? newId() : job.id); };
        }
        tr.oncomplete = () => resolve(out);
        tr.onerror = () => reject(tr.error);
        tr.onabort = () => reject(tr.error);
      });
    }

    function startPut(job, direct) {
      if (conn) {
        try { return putWork(conn, job, direct).then((out) => ({ d: conn, out })); } catch (e) { conn = null; dbp = null; }
      }
      return db().then((d) => putWork(d, job, direct).then((out) => ({ d, out })));
    }

    // Writes the current document. The work id, its name and the text are read here, before anything waits, so a work
    // opened meanwhile never receives the previous work's text.
    function writeNow(direct) {
      const job = { id: workId, name: app.titleOf() || '', text: D.serialize({ doc: app.doc, side: app.store.side }) };
      if (job.text === saved.text && job.id === saved.id) { setState('saved'); return writing; }
      setState('saving');
      writing = startPut(job, direct).then(async ({ d, out }) => {
        saved = { id: out.id, text: job.text };
        if (out.id !== job.id && workId === job.id) {
          setWork(out.id);
          app.toast(t('io.forked'), { kind: 'warn' });
        }
        if (workId === out.id) setState('saved');
        if (!direct) await prune(d);
      }).catch((e) => {
        const quota = e && e.name === 'QuotaExceededError';
        setState(quota ? 'quota' : 'failed');
        if (quota) app.toast(t('io.quota'), { kind: 'error', action: { label: t('io.saveFile'), run: () => saveAs() } });
      });
      return writing;
    }
    const pending = dom.debounce(() => writeNow(false), AUTOSAVE_MS);

    // Every change reads 保存中… at once: the header never calls a change saved before it is written.
    function schedule() {
      setState('saving');
      pending();
    }

    // flush() → Promise: the pending autosave starts now; resolves when the newest write is done.
    function flush() {
      if (pending.pending()) { pending.cancel(); return writeNow(false); }
      return writing;
    }

    // Leaving the page (reload, close, language switch, a hidden tab that may be discarded): the pending autosave is put
    // within this task, so the browser commits it with the page.
    function flushNow() {
      if (pending.pending()) { pending.cancel(); writeNow(true); }
    }

    // Old works beyond the newest RECENT go, and so does every song's audio that no kept work, the current document or
    // this tab's undo history (songs it stored or read since the last load) still uses.
    async function prune(d) {
      const all = ((await tx(d, 'works', 'readonly', (s) => s.getAll())) || []).sort((a, b) => b.at - a.at);
      const old = all.slice(RECENT);
      if (old.length) await tx(d, 'works', 'readwrite', (s) => { for (const w of old) s.delete(w.id); });
      const keep = songsInUse(all.slice(0, RECENT).map((w) => w.text), [...used, app.doc.song ? app.doc.song.sha1 : null]);
      const keys = (await tx(d, 'songs', 'readonly', (s) => s.getAllKeys())) || [];
      const drop = keys.filter((k) => !keep.has(k));
      if (drop.length) await tx(d, 'songs', 'readwrite', (s) => { for (const k of drop) s.delete(k); });
      // an asset's blob, index and thumbs stay while a kept work, the current document or this tab's history uses it
      const keepMedia = mediaInUse(all.slice(0, RECENT).map((w) => w.text), [app.doc], usedMedia);
      for (const name of MEDIA_STORES) {
        const ids = (await tx(d, name, 'readonly', (s) => s.getAllKeys())) || [];
        const gone = ids.filter((k) => !keepMedia.has(k));
        if (gone.length) await tx(d, name, 'readwrite', (s) => { for (const k of gone) s.delete(k); });
        for (const k of [...memory[name].keys()]) if (!keepMedia.has(k)) memory[name].delete(k);
      }
    }

    // The newest autosaved work, or null. When another tab has it open, this tab continues in a copy.
    async function restore() {
      try {
        const d = await db();
        const all = await tx(d, 'works', 'readonly', (s) => s.getAll());
        const newest = (all || []).sort((a, b) => b.at - a.at)[0];
        if (!newest) return null;
        const file = M.parseFile(newest.text);
        const release = await acquire(newest.id, LOCK_WAIT_MS);
        if (release) {
          setWork(newest.id, release);
          await claim(d, newest.id);
          saved = { id: newest.id, text: newest.text };
          setState('saved');
        } else {
          setWork(newId());
          saved = { id: null, text: null };
          app.toast(t('io.tabCopy', { name: newest.name || t('hdr.untitled') }), { kind: 'info' });
        }
        return file;
      } catch (e) {
        return null;
      }
    }

    async function recent() {
      try {
        const d = await db();
        const all = await tx(d, 'works', 'readonly', (s) => s.getAll());
        return (all || []).sort((a, b) => b.at - a.at).map((w) => ({ id: w.id, name: w.name, at: w.at }));
      } catch (e) { return []; }
    }

    async function openRecent(id) {
      await flush();
      const d = await db();
      const w = await tx(d, 'works', 'readonly', (s) => s.get(id));
      if (!w) return false;
      const file = M.parseFile(w.text);
      const release = id === workId ? null : await acquire(id, 0);
      if (id !== workId && !release) {                      // open in another tab: continue in a copy
        await loadFile(file, newId());
        app.toast(t('io.tabCopy', { name: w.name || t('hdr.untitled') }), { kind: 'info' });
        return true;
      }
      await loadFile(file, id, release);
      await claim(d, id);
      return true;
    }

    async function putSong(sha1, blob) {
      used.add(sha1);
      try { const d = await db(); await tx(d, 'songs', 'readwrite', (s) => s.put(blob, sha1)); } catch (e) { /* the song stays in memory */ }
    }

    async function getSong(sha1) {
      try {
        const d = await db();
        const blob = (await tx(d, 'songs', 'readonly', (s) => s.get(sha1))) || null;
        if (blob) used.add(sha1);
        return blob;
      } catch (e) { return null; }
    }

    // --- photos and videos on this device (§11.2.7): media { blob, mime, bytes, crc, name }, mediaIndex, thumbs ------

    // The first media import asks the browser to keep this site's storage (Chrome may otherwise evict large assets);
    // the answer is not needed.
    function persistOnce() {
      if (persistAsked) return;
      persistAsked = true;
      try {
        const st = typeof navigator !== 'undefined' ? navigator.storage : null;
        if (st && typeof st.persist === 'function') st.persist().catch(() => {});
      } catch (e) { /* not available */ }
    }

    // put into one of the media stores → { stored: true } or { stored: false, reason: 'quota' | 'nodb' } (kept in memory)
    async function putIn(name, id, rec) {
      usedMedia.add(id);
      try {
        const d = await db();
        await tx(d, name, 'readwrite', (s) => s.put(rec, id));
        memory[name].delete(id);
        return { stored: true, reason: null };
      } catch (e) {
        memory[name].set(id, rec);
        return { stored: false, reason: e && e.name === 'QuotaExceededError' ? 'quota' : 'nodb' };
      }
    }

    async function getFrom(name, id) {
      if (memory[name].has(id)) { usedMedia.add(id); return memory[name].get(id); }
      try {
        const d = await db();
        const rec = (await tx(d, name, 'readonly', (s) => s.get(id))) || null;
        if (rec) usedMedia.add(id);
        return rec;
      } catch (e) { return null; }
    }

    async function putMedia(id, rec) { persistOnce(); return putIn('media', id, rec); }
    function getMedia(id) { return getFrom('media', id); }
    function putIndex(id, rec) { return putIn('mediaIndex', id, rec); }
    function getIndex(id) { return getFrom('mediaIndex', id); }
    function putThumbs(id, rec) { return putIn('thumbs', id, rec); }
    function getThumbs(id) { return getFrom('thumbs', id); }

    // true when the asset's bytes are on this device (or in this session's memory)
    async function hasMedia(id) {
      if (memory.media.has(id)) return true;
      try {
        const d = await db();
        return ((await tx(d, 'media', 'readonly', (s) => s.count(id))) || 0) > 0;
      } catch (e) { return false; }
    }

    // storageInfo() → { usage, quota, persisted } (navigator.storage; zeros where the browser does not tell)
    async function storageInfo() {
      const st = typeof navigator !== 'undefined' ? navigator.storage : null;
      let usage = 0, quota = 0, persisted = false;
      try { if (st && st.estimate) { const est = await st.estimate(); usage = est.usage || 0; quota = est.quota || 0; } } catch (e) { /* unknown */ }
      try { if (st && st.persisted) persisted = !!(await st.persisted()); } catch (e) { /* unknown */ }
      return { usage, quota, persisted };
    }

    // The device store for media/host/probe.importFile, and the blob source of media/host/store.createMediaStore.
    const device = Object.freeze({ hasMedia, putMedia, getMedia, putIndex, getIndex, putThumbs, getThumbs });
    const mediaBlobs = Object.freeze({
      get: async (id) => { const r = await getMedia(id); return r && r.blob ? r.blob : null; },
      index: getIndex, thumbs: getThumbs, putIndex, putThumbs,
    });

    // The asset ids of the document whose bytes are not on this device.
    async function missingMedia(doc) {
      const out = [];
      for (const e of (doc && doc.media && doc.media.list) || []) if (!(await hasMedia(e.id))) out.push(e.id);
      return out;
    }

    // 「{n}件の写真・動画がこの端末にありません [つなぎ直す]」 (§11.7.8): the relink picker of ui/media_io.
    async function toastMissing(doc) {
      const n = (await missingMedia(doc)).length;
      const relink = app.media && typeof app.media.relink === 'function'
        ? { label: t('media.relink'), run: () => app.media.relink() } : undefined;
      if (n) app.toast(t('media.missingOpen', { n }), { kind: 'warn', action: relink });
    }

    // --- new / open / save -----------------------------------------------------------------------------------

    // The previous work's pending autosave is written, under its own id, before the new work takes over.
    async function loadFile(file, id, release) {
      await flush();
      setWork(id || newId(), release);
      fileHandle = null;
      fileSaved = null;
      saved = { id: null, text: null };
      used.clear();                                          // loading clears the undo history (§6.10)
      usedMedia.clear();
      // the loaded work's own assets stay while it is open: deleting one and undoing must find its bytes (§11.2.7)
      for (const e of (file.doc && file.doc.media && file.doc.media.list) || []) usedMedia.add(e.id);
      app.loadProject(file.doc, file.side);
      schedule();
    }

    async function newWork() {
      await loadFile({ doc: D.defaultDoc(), side: D.defaultSide() });
      app.toast(t('io.newDone'), { kind: 'info' });
    }

    // Where a file goes (§11.7.2): see routeOf; an MP4, MOV or WebM with a video track is media, one without is the song.
    async function routeFile(file) {
      let sniffed = null;
      try { sniffed = SN.sniff(new Uint8Array(await file.slice(0, SN.HEAD).arrayBuffer())); } catch (e) { sniffed = null; }
      const route = routeOf(file.name, file.type, sniffed);
      if (route !== 'container') return route;
      return (await hasVideoTrack(file, sniffed)) ? 'media' : 'song';
    }

    async function hasVideoTrack(file, sniffed) {
      const read = PR.blobReader(file);
      try {
        const mkv = sniffed.container === 'webm' || sniffed.container === 'matroska';
        const movie = mkv ? await MKV.parse(read, file.size, { tracksOnly: true }) : await ISO.parse(read, file.size);
        return movie.tracks.some((tr) => tr.kind === 'video');
      } catch (e) {
        return sniffed.mime !== 'audio/mp4';               // damaged: the importer names the problem
      }
    }

    // openFiles(files, { target }) — target 'stage' when the files were dropped on the preview (§11.7.2: the first photo
    // or video becomes the background there). A package opens with the progress rows of ui/media_io.
    async function openFiles(files, opts) {
      const media = [];
      for (const f of files) {
        const route = await routeFile(f);
        if (route === 'package') await withProgress('open', f, (pr) => openPackage(f, pr));
        else if (route === 'project') await openProject(f);
        else if (route === 'lyrics') await openLyrics(f);
        else if (route === 'song') app.loadSong(f);
        else if (route === 'media') media.push(f);
        else app.toast(t('io.unknownFile', { name: f.name }), { kind: 'error' });
      }
      if (media.length) await importMediaFiles(media, opts);
    }

    // withProgress(kind, file, fn) → fn({ signal, onProgress }): the progress of a package save or open from ui/media_io
    // (a toast row with [中止], and the header's 「ファイルに保存中… 42%」 while saving); plain {} without it. The row
    // closes when fn settles.
    async function withProgress(kind, file, fn) {
      const pr = app.media && typeof app.media.fileProgress === 'function' ? app.media.fileProgress(kind, file) || {} : {};
      try { return await fn(pr); } finally { if (typeof pr.done === 'function') pr.done(); }
    }

    // Photos and videos: the full import flow of §11.7.2 belongs to ui/media_io, which sets app.media; without it each
    // file is imported here and added to the library as one undoable step.
    async function importMediaFiles(files, opts) {
      if (app.media && typeof app.media.importFiles === 'function') return app.media.importFiles(files, opts);
      const entries = [];
      for (const f of files) {
        const entry = await importMedia(f);
        if (entry) entries.push(entry);
      }
      if (entries.length) app.toast(t('media.done', { n: entries.length }), { kind: 'ok' });
      return entries;
    }

    // importMedia(file, { signal, onProgress }) → the entry (added to the library unless it is there), or null after a
    // toast that names the problem (media.err.*).
    async function importMedia(file, opts) {
      const o = opts || {};
      let res;
      try {
        res = await PR.importFile(file, { name: file.name, store: device, signal: o.signal, onProgress: o.onProgress,
          idle: app.svc && app.svc.canvas && app.svc.canvas.idle });
      } catch (e) {
        if (e && e.name === 'AbortError') return null;
        if (e && e.code === 'audioOnly') { app.loadSong(file); return null; }
        const code = e && e.code && t.has('media.err.' + e.code) ? e.code : 'broken';
        app.toast(t('media.err.' + code, { name: file.name, codec: e && e.detail && e.detail.codec ? e.detail.codec : '?' }), { kind: 'error' });
        return null;
      }
      const list = app.doc.media ? app.doc.media.list : [];
      if (list.some((e) => e.id === res.entry.id)) {
        app.toast(t('media.dup', { name: file.name }), { kind: 'info' });
      } else if (list.length >= MEDIA.LIMITS.library) {
        app.toast(t('media.full'), { kind: 'error' });
        return null;
      } else {
        app.dispatch({ t: 'media.put', entry: res.entry }, { label: ['undo.media.put', {}] });
      }
      if (res.notes.includes('quota')) app.toast(t('media.err.quota'), { kind: 'error', action: { label: t('io.saveFile'), run: () => saveAs() } });
      else if (res.notes.includes('memoryOnly')) app.toast(t('media.warn.memoryOnly'), { kind: 'warn' });
      if (res.notes.includes('bigFile')) app.toast(t('media.warn.bigFile', { size: T.fmtBytes(res.entry.bytes) }), { kind: 'info' });
      return res.entry;
    }

    // The file is parsed completely before anything changes, so a file that does not parse leaves the work as it was.
    // A failure that is not a MigrateError is reported as a damaged file, never as "not JSON".
    async function openProject(file) {
      let parsed;
      try {
        parsed = M.parseFile(await file.text());
      } catch (e) {
        const code = e instanceof M.MigrateError && t.has('err.file.' + e.code) ? e.code : 'invalid';
        const n = e && Array.isArray(e.problems) && e.problems.length ? e.problems.length : 1;
        app.toast(t('err.file.' + code, { n, name: file.name }), { kind: 'error' });
        return false;
      }
      try {
        await loadFile(parsed);                 // the store's 'doc' event re-links the song by sha1 (ui/boot syncSong)
      } catch (e) {
        if (typeof console !== 'undefined') console.error(e);
        app.toast(t('err.command'), { kind: 'error' });
        return false;
      }
      app.toast(t('io.opened', { name: file.name }), { kind: 'ok' });
      await toastMissing(parsed.doc);           // light files hold ids only: the bytes come from this device (§11.2.9)
      return true;
    }

    // --- the project package (.mojipv, §12) ------------------------------------------------------------------------

    const pkgError = (code) => ({ truncated: 'pkg.err.truncated', 'not-zip': 'pkg.err.notPackage', unsupported: 'pkg.err.unsupported' }[code] || 'pkg.err.invalid');

    function abortError() { const e = new Error('cancelled'); e.name = 'AbortError'; return e; }
    function checkAbort(signal) { if (signal && signal.aborted) throw abortError(); }

    // The CRC-32 of a song blob, once per session (§12.3: songs are ≤ 200 MB, so one streaming pass is ≤ 1 s).
    async function songCrc(sha1, blob) {
      if (songCrcs.has(sha1)) return songCrcs.get(sha1);
      let crc = 0;
      for (let at = 0; at < blob.size; at += 8 * MB) crc = Z.crc32(new Uint8Array(await blob.slice(at, at + 8 * MB).arrayBuffer()), crc);
      songCrcs.set(sha1, crc >>> 0);
      return crc >>> 0;
    }

    async function mimeOf(blob) {
      if (blob.type && blob.type !== 'application/octet-stream') return blob.type;
      try { return SN.sniff(new Uint8Array(await blob.slice(0, SN.HEAD).arrayBuffer())).mime || 'application/octet-stream'; } catch (e) { return 'application/octet-stream'; }
    }

    // The blobs of the document's assets and song, from this device: { have, blobs } for export/package.layout.
    async function collect(doc) {
      const have = { media: new Map(), thumbs: new Map(), song: null };
      const blobs = new Map();
      for (const e of (doc.media && doc.media.list) || []) {
        const rec = await getMedia(e.id);
        if (!rec || !rec.blob) continue;
        const crc = Number.isInteger(rec.crc) ? rec.crc : (await PR.hashBlob(rec.blob)).crc;
        have.media.set(e.id, { bytes: rec.blob.size, crc, mime: rec.mime || e.mime });
        blobs.set('media:' + e.id, rec.blob);
        const th = await getThumbs(e.id);
        if (th && th.poster) {
          const bytes = new Uint8Array(await th.poster.arrayBuffer());
          have.thumbs.set(e.id, { bytes: bytes.length, crc: Z.crc32(bytes) });
          blobs.set('thumb:' + e.id, th.poster);
        }
      }
      if (doc.song) {
        const blob = await getSong(doc.song.sha1);
        if (blob) {
          have.song = { sha1: doc.song.sha1, bytes: blob.size, crc: await songCrc(doc.song.sha1, blob), mime: await mimeOf(blob) };
          blobs.set('song', blob);
        }
      }
      return { have, blobs };
    }

    function pickerTypes() {
      return {
        pkg: { description: t('io.typePkg'), accept: { [PKG.MIME]: [PKG.EXT] } },
        json: { description: t('io.typeJson'), accept: { 'application/json': ['.json'] } },
      };
    }

    // savePackage(handle | null, { signal, onProgress }) → { name, bytes, missing, kind: 'package' | 'light' } | null.
    // Every asset and the song stream into one store-only ZIP (§12.3): with File System Access straight from IndexedDB
    // into the file, else as Blob parts of one Blob that is downloaded. The document is snapshotted first, so editing may
    // go on during the save.
    async function savePackage(handle, opts) {
      const o = opts || {};
      const doc = app.doc, side = app.store.side;
      const { have, blobs } = await collect(doc);
      const lay = PKG.layout(doc, side, have);
      const size = T.fmtBytes(lay.bytes);
      if (lay.bytes > PKG_BIG && app.confirm && !(await app.confirm({ text: t('pkg.warn.big', { size }) }))) return null;
      let target = handle || null;
      let sink;
      const name = target ? target.name : fileName(PKG.EXT);
      if (!target && SINK.canStream()) {
        try {
          const types = pickerTypes();
          target = await globalThis.showSaveFilePicker({ suggestedName: name, types: [types.pkg, types.json] });
        } catch (e) {
          if (e && e.name === 'AbortError') return null;
          target = null;
        }
        if (target && PROJECT_EXT.test(target.name)) return saveLight(target);
      }
      if (target) sink = SINK.createFileSink(target);
      else {
        if (lay.bytes > PKG_MEMORY && app.confirm && !(await app.confirm({ text: t('pkg.warn.memory', { size }) }))) return null;
        sink = SINK.createMemorySink({ name, type: PKG.MIME });
      }
      const zip = Z.createZip((part) => sink.write(part));
      try {
        let done = 0;
        for (const e of lay.order) {
          checkAbort(o.signal);
          if (e.text !== undefined) await zip.add(e.name, Z.utf8(e.text));
          else await zip.addBlob(e.name, blobs.get(e.role === 'song' ? 'song' : e.role + ':' + e.id), { crc: e.crc });
          done += e.bytes;
          if (o.onProgress) o.onProgress(Math.min(1, done / Math.max(1, lay.bytes)));
        }
        await zip.finish();
        const res = await sink.close();
        if (sink.kind === 'memory') SINK.downloadBlob(res.blob, name);
      } catch (e) {
        await sink.abort();
        if (e && e.name === 'AbortError') return null;
        app.toast(t('io.saveFailed'), { kind: 'error' });
        return null;
      }
      if (target) fileHandle = target;
      fileSaved = { name: target ? target.name : name, at: Date.now(), text: lay.projectText };
      savedToast(lay, size, !!doc.song && !have.song);
      return { name: fileSaved.name, bytes: lay.bytes, missing: lay.missing.slice(), songMissing: !!doc.song && !have.song, kind: 'package' };
    }

    // 保存しました: …, in one toast that stays readable after the save: what is not in the file because it is not on this
    // device (photos and videos, the song) is part of it, with [つなぎ直す] (DESIGN_2_1 §12.7).
    function savedToast(lay, size, songMissing) {
      const c = contentsOf(lay);
      const params = { name: fileSaved.name, size, what: t(c.song ? 'io.savedWhat' : 'io.savedWhatNoSong', { p: c.p, v: c.v }) };
      const n = lay.missing.length;
      if (!n && !songMissing) { app.toast(t('io.savedPkg', params), { kind: 'ok' }); return; }
      const missing = [n ? t('pkg.missing.media', { n }) : null, songMissing ? t('pkg.missing.song') : null].filter(Boolean).join(t('pkg.missing.and'));
      const relink = n && app.media ? () => app.media.relink() : songMissing && app.pickRelink ? () => app.pickRelink() : null;
      app.toast(t('io.savedMissing', Object.assign(params, { missing })), { kind: 'warn', sticky: true,
        action: relink ? { label: t('media.relink'), run: relink } : undefined });
    }

    // saveLight(handle?) → the .json save (ids only, §11.2.9); the toast says what is not in it.
    async function saveLight(handle) {
      const text = D.serialize({ doc: app.doc, side: app.store.side });
      const heavy = (app.doc.media && app.doc.media.list.length) || app.doc.song;
      const note = heavy ? '\n' + t('io.savedLight') : '';
      if (handle) {
        try {
          await writeHandle(handle, text);
          fileHandle = handle;
          fileSaved = { name: handle.name, at: Date.now(), text };
          app.toast(t('io.saved', { name: handle.name }) + note, { kind: 'ok' });
          return { name: handle.name, bytes: text.length, missing: [], kind: 'light' };
        } catch (e) {
          app.toast(t('io.saveFailed'), { kind: 'error' });
          return null;
        }
      }
      let got = null;
      await saveText(text, fileName('.json'), 'application/json', (h) => { fileHandle = h; got = h; }, note);
      if (got) fileSaved = { name: got.name, at: Date.now(), text };
      return { name: got ? got.name : fileName('.json'), bytes: text.length, missing: [], kind: 'light' };
    }

    // openPackage(file, { signal, onProgress, handle }) → true when the package opened. Random access through
    // File.slice: the directory, the manifest and project.json are checked first (a damaged one is refused and the work
    // stays as it is); then each asset not yet on this device is verified (CRC-32, and SHA-256 = its id for media) and
    // stored as a slice of the file. A damaged asset is skipped and reported (pkg.warn.damaged): it is missing, to relink.
    async function openPackage(file, opts) {
      const o = opts || {};
      const read = PR.blobReader(file);
      const fail = (key) => { app.toast(t(key, { name: file.name }), { kind: 'error' }); return false; };
      let zip;
      try { zip = await U.openZip(read, file.size, { maxEntries: PKG.LIMITS.entries }); } catch (e) {
        return fail(pkgError(e && e.code));
      }
      if (PKG.mimetypeProblem(zip.entries) || SN.sniff(await read(0, 64)).kind !== 'package') return fail('pkg.err.notPackage');
      const entryBytes = async (entry) => {
        const start = await U.dataStart(read, entry);
        const bytes = await read(start, entry.bytes);
        if (bytes.length !== entry.bytes || Z.crc32(bytes) !== entry.crc) throw Object.assign(new Error('crc'), { code: 'bad-entry' });
        return bytes;
      };
      let manifest, plan, parsed;
      try {
        const me = zip.entries.get(PKG.MANIFEST);
        if (!me || me.bytes > PKG.LIMITS.manifest) return fail('pkg.err.invalid');
        manifest = JSON.parse(U.utf8Decode(await entryBytes(me)) || 'null');
        const problems = PKG.manifestProblems(manifest, zip.entries);
        if (problems.some((p) => p.startsWith('newer'))) return fail('pkg.err.newer');
        if (problems.length) return fail('pkg.err.invalid');
        plan = PKG.readPlan(manifest, zip.entries);
        const text = U.utf8Decode(await entryBytes(plan.project));
        if (text === null) return fail('pkg.err.invalid');
        checkAbort(o.signal);
        try {
          parsed = M.parseFile(text);
        } catch (e) {
          const code = e instanceof M.MigrateError && t.has('err.file.' + e.code) ? e.code : 'invalid';
          const n = e && Array.isArray(e.problems) && e.problems.length ? e.problems.length : 1;
          app.toast(t('err.file.' + code, { n, name: file.name }), { kind: 'error' });
          return false;
        }
      } catch (e) {
        if (e && e.name === 'AbortError') return false;
        return fail(e && e.code === 'truncated' ? 'pkg.err.truncated' : 'pkg.err.invalid');
      }
      // assets: dedupe by id / sha1, verify, store the slice itself
      const names = new Map(((parsed.doc.media && parsed.doc.media.list) || []).map((e) => [e.id, e.name]));
      const total = plan.media.reduce((n, m) => n + m.entry.bytes, 0) + (plan.song ? plan.song.entry.bytes : 0);
      let done = 0, damaged = 0, count = 0;
      const report = () => { if (o.onProgress) o.onProgress({ p: total ? done / total : 1, i: count, n: plan.media.length }); };
      try {
        for (const m of plan.media) {
          checkAbort(o.signal);
          count++;
          if (await hasMedia(m.id)) { done += m.entry.bytes; report(); continue; }
          const start = await U.dataStart(read, m.entry);
          const slice = file.slice(start, start + m.entry.bytes, m.mime);
          const base = done;
          const hashed = await PR.hashBlob(slice, { signal: o.signal, onProgress: (p) => { done = base + p * m.entry.bytes; report(); } });
          done = base + m.entry.bytes;
          if (hashed.id !== m.id || hashed.crc !== m.entry.crc) { damaged++; continue; }
          await putMedia(m.id, { blob: slice, mime: m.mime, bytes: m.entry.bytes, crc: m.entry.crc, name: names.get(m.id) || m.id });
          report();
        }
        for (const th of plan.thumbs) {
          checkAbort(o.signal);
          if (!(await hasMedia(th.id)) || await getThumbs(th.id)) continue;
          try {
            const bytes = await entryBytes(th.entry);
            await putThumbs(th.id, { v: PR.THUMB_V, poster: new Blob([bytes], { type: 'image/webp' }), strip: null, tiles: 0 });
          } catch (e) { /* a damaged poster is made again from the asset */ }
        }
        if (plan.song) {
          checkAbort(o.signal);
          const sha1 = plan.song.sha1;
          if (!(await getSong(sha1))) {
            const start = await U.dataStart(read, plan.song.entry);
            const slice = file.slice(start, start + plan.song.entry.bytes, plan.song.mime);
            let crc = 0;
            for (let at = 0; at < slice.size; at += 8 * MB) {
              crc = Z.crc32(new Uint8Array(await slice.slice(at, at + 8 * MB).arrayBuffer()), crc);
              checkAbort(o.signal);
            }
            const songName = parsed.doc.song && parsed.doc.song.sha1 === sha1 ? parsed.doc.song.name : 'song.' + PKG.extOf(plan.song.mime);
            if ((crc >>> 0) === plan.song.entry.crc) {
              await putSong(sha1, new File([slice], songName, { type: plan.song.mime }));
              songCrcs.set(sha1, crc >>> 0);
            } else damaged++;
          }
          done += plan.song.entry.bytes;
          report();
        }
      } catch (e) {
        if (e && e.name === 'AbortError') return false;       // the work is untouched; stored assets are pruned later
        return fail('pkg.err.truncated');
      }
      await loadFile(parsed);
      if (o.handle) fileHandle = o.handle;
      fileSaved = { name: file.name, at: Date.now(), opened: true, text: D.serialize({ doc: parsed.doc, side: parsed.side }) };
      app.toast(t('io.opened', { name: file.name }), { kind: 'ok' });
      if (damaged) app.toast(t('pkg.warn.damaged', { n: damaged }), { kind: 'warn' });
      await toastMissing(parsed.doc);
      return true;
    }

    // fileState() → { name, at, dirty } of the file this work was last saved to or opened from, or null (§12.5).
    // fileState() → { name, at, opened, dirty } of the project file: `opened` until the first save to it (the header then
    // says 「…に開きました」, not 「…に保存」).
    function fileState() {
      if (!fileSaved) return null;
      return { name: fileSaved.name, at: fileSaved.at, opened: !!fileSaved.opened,
        dirty: D.serialize({ doc: app.doc, side: app.store.side }) !== fileSaved.text };
    }

    // A lyric or LRC file in UTF-8 / UTF-16 (with a BOM), Shift_JIS or EUC-JP; the toast names a legacy encoding.
    async function openLyrics(file) {
      const decoded = decodeText(await file.arrayBuffer());
      const text = decoded.text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
      if (app.tap && app.tap.active()) app.tap.cancel();     // its marks belong to the lines being replaced
      const list = app.store.side.looks && app.store.side.looks.list;
      const first = !Array.isArray(list) || !list.length;
      app.store.seal();
      app.dispatch({ t: 'lyrics.set', text }, { label: ['undo.import', { name: file.name }] });
      app.store.seal();
      const legacy = ENCODING_NAMES[decoded.encoding];
      const note = !decoded.sure ? t('io.encodingUnknown') : legacy ? t('io.encoding', { enc: legacy }) : '';
      app.toast(t('io.lyricsIn', { name: file.name }) + (note ? '\n' + note : ''), { kind: decoded.sure ? 'ok' : 'warn' });
      if (first) app.firstRun();
    }

    async function open() {
      if (typeof window.showOpenFilePicker === 'function') {
        try {
          const handles = await window.showOpenFilePicker({ multiple: false, types: [{ description: t('io.fileTypes'),
            accept: { [PKG.MIME]: [PKG.EXT], 'application/json': ['.json'], 'text/plain': ['.txt', '.lrc'],
              'audio/*': ['.mp3', '.wav', '.m4a', '.ogg', '.flac'], 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.svg'],
              'video/*': ['.mp4', '.m4v', '.mov', '.webm', '.mkv'] } }] });
          const file = await handles[0].getFile();
          const route = await routeFile(file);
          if (route === 'package') {
            await withProgress('open', file, (pr) => openPackage(file, Object.assign({}, pr, { handle: handles[0] })));
            return;
          }
          await openFiles([file]);
          if (route === 'project') { fileHandle = handles[0]; fileSaved = { name: file.name, at: Date.now(), opened: true, text: D.serialize({ doc: app.doc, side: app.store.side }) }; }
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return;
        }
      }
      await openFiles(await dom.pickFiles('.mojipv,.json,.txt,.lrc,audio/*,image/*,video/*', false));
    }

    function fileName(ext) {
      return (safeName(app.titleOf()) || t('io.defaultName')) + ext;
    }

    async function writeHandle(handle, text) {
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
    }

    // 保存 (Ctrl+S): the same kind as the current file handle (a .mojipv handle gets a package, a .json handle a light
    // save); without a handle it is 名前を付けて保存 with the package type first (§12.3).
    async function save(opts) {
      if (!fileHandle) return saveAs(opts);
      if (PACKAGE_EXT.test(fileHandle.name)) return opts ? savePackage(fileHandle, opts) : withProgress('save', null, (pr) => savePackage(fileHandle, pr));
      return saveLight(fileHandle);
    }

    // 名前を付けて保存: a package by default (the picker also offers the light .json). opts = { signal, onProgress }
    // (ui/media_io's progress row when absent).
    function saveAs(opts) { return opts ? savePackage(null, opts) : withProgress('save', null, (pr) => savePackage(null, pr)); }

    async function saveText(text, name, type, onHandle, note) {
      if (typeof window.showSaveFilePicker === 'function') {
        try {
          const ext = name.slice(name.lastIndexOf('.'));
          const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: name, accept: { [type]: [ext] } }] });
          await writeHandle(handle, text);
          if (onHandle) onHandle(handle);
          app.toast(t('io.saved', { name: handle.name }) + (note || ''), { kind: 'ok' });
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return;
        }
      }
      dom.download(new Blob([text], { type: type + ';charset=utf-8' }), name);
      app.toast(t('io.downloaded', { name }) + (note || ''), { kind: 'ok' });
    }

    // 時間つき歌詞（.lrc）: meta rows as written, each lyric row with the effective start of every occurrence
    // (export/subtitles.lrc, which the Filmora kit writes too; DESIGN_2_1 §13.8).
    function lrcText() { return SUB.lrc(app.plan, app.doc); }

    function saveLrc() { return saveText(lrcText(), fileName('.lrc'), 'text/plain'); }

    // --- global drop routing and the page's lifetime --------------------------------------------------------------

    function installDrop(root) {
      let depth = 0;
      const has = (ev) => ev.dataTransfer && [...ev.dataTransfer.types].includes('Files');
      window.addEventListener('dragenter', (ev) => { if (has(ev)) { depth++; root.classList.add('is-dropping'); } });
      window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) root.classList.remove('is-dropping'); });
      window.addEventListener('dragover', (ev) => { if (has(ev)) ev.preventDefault(); });
      window.addEventListener('drop', (ev) => {
        if (!has(ev)) return;
        ev.preventDefault();
        depth = 0;
        root.classList.remove('is-dropping');
        openFiles([...ev.dataTransfer.files], { target: ev.mvTarget || null });   // ui/stage marks a drop on the preview
      });
      window.addEventListener('pagehide', flushNow);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow(); });
      db().catch(() => {});                                 // open the database now, so flushNow never waits for it
    }

    // ≡ › 設定 › この端末に保存した作品と曲を消す (asked first by ui/menus): every autosaved work and every stored song
    // leave IndexedDB, and every AI key leaves session and local storage. The open work closes too — an empty work takes
    // its place and is stored at its first change — so nothing written before stays. Another tab that still has a work
    // open stores that work again at its next change. → Promise<boolean>: false when the database could not be cleared.
    async function clearDevice() {
      pending.cancel();
      await writing;                                         // a write already under way lands first, then goes too
      if (app.ai && typeof app.ai.forgetKeys === 'function') app.ai.forgetKeys();   // the AI panel's state follows
      else AC.createKeyStore(storage('sessionStorage'), storage('localStorage')).clearAll();
      let ok = true;
      try {
        const d = await db();
        await tx(d, 'works', 'readwrite', (s) => s.clear());
        await tx(d, 'songs', 'readwrite', (s) => s.clear());
        for (const name of MEDIA_STORES) await tx(d, name, 'readwrite', (s) => s.clear());
      } catch (e) { ok = false; }
      for (const name of MEDIA_STORES) memory[name].clear();
      songCrcs.clear();
      setWork(newId());
      fileHandle = null;
      fileSaved = null;
      saved = { id: null, text: null };
      used.clear();
      usedMedia.clear();
      app.loadProject(D.defaultDoc(), D.defaultSide(), { quiet: true });
      pending.cancel();                                      // the empty work is stored at its first change, not now
      setState('idle');
      app.bus.emit('device', { cleared: true });             // the AssetStore forgets what it held (ui/media_io)
      return ok;
    }

    function begin(id) { setWork(id || workId || newId()); }

    return {
      state: () => state, schedule, flush, flushNow, restore, recent, openRecent, newWork, open, openFiles,
      save, saveAs, saveLight, savePackage, openPackage, saveLrc, lrcText, putSong, getSong, installDrop, begin, fileName,
      clearDevice, workId: () => workId, fileState,
      putMedia, getMedia, hasMedia, putIndex, getIndex, putThumbs, getThumbs, storageInfo, missingMedia, importMedia,
      importMediaFiles, routeFile, device, mediaBlobs, usedMedia,
    };
  }

  return { create, lrcTag, safeName, decodeText, songsInUse, mediaInUse, routeOf, quotaNote, contentsOf, RECENT, DB_VERSION,
    MEDIA_STORES };
});
