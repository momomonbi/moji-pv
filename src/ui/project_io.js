/* 文字PVメーカー v2 — original work. Project I/O: new / open / save / save as / .lrc, autosave to IndexedDB (doc + side, songs by sha1), drop routing, clearing the device. */
MV.def('ui/project_io', ['ui/dom', 'core/doc', 'core/migrate', 'core/lyrics', 'i18n/t', 'ui/ai_controller'], (dom, D, M, L, T, AC) => {
  'use strict';

  const DB_NAME = 'mojipv-v2';
  const DB_VERSION = 1;
  const RECENT = 5;
  const AUTOSAVE_MS = 1000;
  const LOCK_PREFIX = 'mojipv-work:';   // one Web Lock per open work: two tabs never write the same record
  const LOCK_WAIT_MS = 1500;            // a reloaded page may still see its previous document's lock for a moment
  const LYRIC_EXT = /\.(txt|lrc)$/i;
  const PROJECT_EXT = /\.json$/i;
  const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|webm)$/i;

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

  // --- IndexedDB (every call tolerates a missing or failing database) ------------------------------------------

  function openDb() {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('works')) db.createObjectStore('works', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs');
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

    // --- new / open / save -----------------------------------------------------------------------------------

    // The previous work's pending autosave is written, under its own id, before the new work takes over.
    async function loadFile(file, id, release) {
      await flush();
      setWork(id || newId(), release);
      fileHandle = null;
      saved = { id: null, text: null };
      used.clear();                                          // loading clears the undo history (§6.10)
      app.loadProject(file.doc, file.side);
      schedule();
    }

    async function newWork() {
      await loadFile({ doc: D.defaultDoc(), side: D.defaultSide() });
      app.toast(t('io.newDone'), { kind: 'info' });
    }

    async function openFiles(files) {
      for (const f of files) {
        if (PROJECT_EXT.test(f.name) || f.type === 'application/json') await openProject(f);
        else if (LYRIC_EXT.test(f.name) || f.type.startsWith('text/')) await openLyrics(f);
        else if (AUDIO_EXT.test(f.name) || f.type.startsWith('audio/')) app.loadSong(f);
        else app.toast(t('io.unknownFile', { name: f.name }), { kind: 'error' });
      }
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
      return true;
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
            accept: { 'application/json': ['.json'], 'text/plain': ['.txt', '.lrc'], 'audio/*': ['.mp3', '.wav', '.m4a', '.ogg', '.flac'] } }] });
          const file = await handles[0].getFile();
          await openFiles([file]);
          if (PROJECT_EXT.test(file.name)) fileHandle = handles[0];
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return;
        }
      }
      await openFiles(await dom.pickFiles('.json,.txt,.lrc,audio/*', false));
    }

    function fileName(ext) {
      return (safeName(app.titleOf()) || t('io.defaultName')) + ext;
    }

    async function writeHandle(handle, text) {
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
    }

    async function save() {
      if (!fileHandle) return saveAs();
      try {
        await writeHandle(fileHandle, D.serialize({ doc: app.doc, side: app.store.side }));
        app.toast(t('io.saved', { name: fileHandle.name }), { kind: 'ok' });
      } catch (e) {
        app.toast(t('io.saveFailed'), { kind: 'error' });
      }
      return undefined;
    }

    async function saveAs() {
      const text = D.serialize({ doc: app.doc, side: app.store.side });
      return saveText(text, fileName('.json'), 'application/json', (h) => { fileHandle = h; });
    }

    async function saveText(text, name, type, onHandle) {
      if (typeof window.showSaveFilePicker === 'function') {
        try {
          const ext = name.slice(name.lastIndexOf('.'));
          const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: name, accept: { [type]: [ext] } }] });
          await writeHandle(handle, text);
          if (onHandle) onHandle(handle);
          app.toast(t('io.saved', { name: handle.name }), { kind: 'ok' });
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return;
        }
      }
      dom.download(new Blob([text], { type: type + ';charset=utf-8' }), name);
      app.toast(t('io.downloaded', { name }), { kind: 'ok' });
    }

    // 時間つき歌詞（.lrc）: meta rows as written, each lyric row with the effective start of every occurrence.
    function lrcText() {
      const plan = app.plan;
      const byRow = new Map();
      for (const l of plan ? plan.lines : []) {
        const row = l.row || l.id;
        if (!byRow.has(row)) byRow.set(row, []);
        byRow.get(row).push(l);
      }
      const out = [];
      for (const row of app.doc.sheet.rows) {
        if (L.isMetaRow(row.src)) { out.push(row.src.trim()); continue; }
        const lines = byRow.get(row.id);
        if (!lines) continue;
        const tags = lines.map((l) => l.t0).sort((a, b) => a - b).map(lrcTag).join('');
        out.push(tags + lines[0].text);
      }
      return out.join('\n') + '\n';
    }

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
        openFiles([...ev.dataTransfer.files]);
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
      } catch (e) { ok = false; }
      setWork(newId());
      fileHandle = null;
      saved = { id: null, text: null };
      used.clear();
      app.loadProject(D.defaultDoc(), D.defaultSide(), { quiet: true });
      pending.cancel();                                      // the empty work is stored at its first change, not now
      setState('idle');
      return ok;
    }

    function begin(id) { setWork(id || workId || newId()); }

    return {
      state: () => state, schedule, flush, flushNow, restore, recent, openRecent, newWork, open, openFiles,
      save, saveAs, saveLrc, lrcText, putSong, getSong, installDrop, begin, fileName, clearDevice, workId: () => workId,
    };
  }

  return { create, lrcTag, safeName, decodeText, songsInUse, RECENT };
});
