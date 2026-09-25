/* 文字PVメーカー v2 — original work. Export sinks: a file on disk (File System Access), a folder of files (the Filmora kit), or memory with a download (§4.21; DESIGN_2_1 §13.9). */
MV.def('export/host/sink', ['export/schedule'], (S) => {
  'use strict';

  const TYPES = Object.freeze({
    mp4: { description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } },
    zip: { description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } },
    webm: { description: 'WebM video', accept: { 'video/webm': ['.webm'] } },
  });
  const MIMES = Object.freeze({ mp4: 'video/mp4', zip: 'application/zip', webm: 'video/webm' });
  const DIRECTORY_ID = 'mojipv-kit';      // the picker remembers the folder chosen last time under this id
  const MAX_NAME_TRIES = 99;              // '<name>', '<name> (2)' … '<name> (99)'

  function sinkError(err) {
    return err && err.code === 'sink' ? err : new S.ExportError('sink', 'writing the file failed: ' + (err && err.message), err);
  }

  // Sink = { kind: 'file' | 'memory', name, bytes, write(part, position?), close() → { bytes, blob? }, abort() }
  // write() without a position appends; with one it writes there (the MP4 stream target patches earlier bytes).
  // A part is a Uint8Array or a Blob (DESIGN_2_1 §12.3: package entries stream from IndexedDB's backing store).

  function partSize(part) { return part instanceof Uint8Array ? part.byteLength : part.size; }

  // createFileSink(fileHandle): streams into the file through createWritable(); abort() discards the written data and
  // removes the file the save dialog created, so a cancelled export leaves nothing behind. States: open → closing →
  // closed, or → aborted. A close() that fails leaves the sink 'failed', and abort() still removes the file then.
  function createFileSink(handle) {
    let writable = null;
    let size = 0;
    let state = 'open';

    async function open() {
      if (!writable) writable = await handle.createWritable({ keepExistingData: false });
      return writable;
    }

    return {
      kind: 'file',
      get name() { return handle.name; },
      get bytes() { return size; },
      async write(bytes, position) {
        if (state !== 'open') throw new S.ExportError('sink', 'file sink is ' + state);
        const at = position === undefined ? size : position;
        try {
          await (await open()).write({ type: 'write', position: at, data: bytes });   // a Blob streams from its source
        } catch (err) {
          throw sinkError(err);
        }
        size = Math.max(size, at + partSize(bytes));
      },
      async close() {
        if (state !== 'open') throw new S.ExportError('sink', 'file sink is ' + state);
        state = 'closing';
        try {
          await (await open()).close();
        } catch (err) {
          if (state === 'closing') state = 'failed';
          throw sinkError(err);
        }
        if (state === 'closing') state = 'closed';
        return { bytes: size };
      },
      async abort() {
        if (state === 'closed' || state === 'aborted') return;
        state = 'aborted';
        try { if (writable) await writable.abort(); } catch (err) { /* the stream may already be errored */ }
        try { if (typeof handle.remove === 'function') await handle.remove(); } catch (err) { /* the file stays empty */ }
        size = 0;
      },
    };
  }

  // createMemorySink(): keeps the written pieces (no copy for appends; a Blob by reference) and builds a Blob on close()
  // from them, so a package of large media is assembled without copying. A Blob can only be appended: a positional
  // write that would change bytes inside a Blob piece throws (nothing writes that way: the ZIP writer only appends).
  function createMemorySink(opts) {
    const type = (opts && opts.type) || 'application/octet-stream';
    let pieces = [];                                  // [{ at, bytes }] in file order, never overlapping
    let size = 0;
    let state = 'open';

    function patch(at, bytes) {
      for (const piece of pieces) {
        const from = Math.max(at, piece.at);
        const to = Math.min(at + bytes.byteLength, piece.at + partSize(piece.bytes));
        if (from >= to) continue;
        if (!(piece.bytes instanceof Uint8Array)) throw new S.ExportError('sink', 'memory sink: cannot overwrite a Blob part');
        piece.bytes.set(bytes.subarray(from - at, to - at), from - piece.at);
      }
    }

    return {
      kind: 'memory',
      name: (opts && opts.name) || null,
      get bytes() { return size; },
      async write(bytes, position) {
        if (state !== 'open') throw new S.ExportError('sink', 'memory sink is ' + state);
        const at = position === undefined ? size : position;
        if (at > size) {
          pieces.push({ at: size, bytes: new Uint8Array(at - size) });
          size = at;
        }
        if (!(bytes instanceof Uint8Array)) {
          if (at < size && bytes.size > 0) throw new S.ExportError('sink', 'memory sink: a Blob part can only be appended');
          pieces.push({ at: size, bytes });
          size += bytes.size;
          return;
        }
        const inside = Math.min(bytes.byteLength, size - at);
        if (inside > 0) patch(at, bytes.subarray(0, inside));
        if (inside < bytes.byteLength) {
          pieces.push({ at: size, bytes: bytes.subarray(Math.max(0, inside)) });
          size = at + bytes.byteLength;
        }
      },
      async close() {
        if (state !== 'open') throw new S.ExportError('sink', 'memory sink is ' + state);
        state = 'closed';
        const blob = new Blob(pieces.map((p) => p.bytes), { type });
        pieces = [];
        return { bytes: size, blob };
      },
      async abort() {
        state = 'aborted';
        pieces = [];
        size = 0;
      },
    };
  }

  function canStream() { return typeof globalThis.showSaveFilePicker === 'function'; }

  // openSink({ name, kind: 'mp4' | 'webm' | 'zip' }) → Sink | null. With File System Access the save dialog opens (call
  // this directly from the click, before any other await); null means the user closed the dialog. Otherwise a memory sink.
  async function openSink(opts) {
    const kind = Object.prototype.hasOwnProperty.call(TYPES, opts.kind) ? opts.kind : 'mp4';
    const type = MIMES[kind];
    if (!canStream()) return createMemorySink({ name: opts.name, type });
    try {
      const handle = await globalThis.showSaveFilePicker({ suggestedName: opts.name, types: [TYPES[kind]] });
      return createFileSink(handle);
    } catch (err) {
      if (err && err.name === 'AbortError') return null;
      throw sinkError(err);
    }
  }

  // --- folders (the Filmora kit, DESIGN_2_1 §13.9) --------------------------------------------------------------

  // createDirSink(dirHandle, { parent?, name? }) → DirSink = { kind: 'dir', name, file(name) → Promise<Sink>, files,
  // close() → { files: [{ name, bytes }] }, abort() }. Each file(name) creates the file in the folder and returns its
  // file sink (createFileSink); a name is used once. close() closes the sinks still open and lists every file written, in
  // order. abort() aborts every file sink (each removes its file) and then removes the folder itself when its parent is
  // known (removeEntry(name, { recursive: true })), else every file it created, so a cancelled kit leaves nothing.
  function createDirSink(dir, opts) {
    const o = opts || {};
    const entries = [];                  // [{ name, sink }] in creation order
    let state = 'open';

    function check() { if (state !== 'open') throw new S.ExportError('sink', 'folder sink is ' + state); }

    return {
      kind: 'dir',
      get name() { return o.name || dir.name; },
      get files() { return entries.map((e) => ({ name: e.name, bytes: e.sink.bytes })); },
      async file(name) {
        check();
        if (entries.some((e) => e.name === name)) throw new S.ExportError('sink', 'folder sink: ' + name + ' is already written');
        let handle;
        try {
          handle = await dir.getFileHandle(name, { create: true });
        } catch (err) {
          throw sinkError(err);
        }
        const inner = createFileSink(handle);
        const entry = { name, sink: inner, closed: false };
        entries.push(entry);
        return {                         // the file sink, remembering that its writer closed it
          kind: 'file',
          get name() { return inner.name; },
          get bytes() { return inner.bytes; },
          write: (bytes, position) => inner.write(bytes, position),
          async close() {
            const done = await inner.close();
            entry.closed = true;
            return done;
          },
          abort: () => inner.abort(),
        };
      },
      async close() {
        check();
        state = 'closing';
        try {
          for (const e of entries) {
            if (!e.closed) { await e.sink.close(); e.closed = true; }
          }
        } catch (err) {
          state = 'failed';
          throw sinkError(err);
        }
        state = 'closed';
        return { files: entries.map((e) => ({ name: e.name, bytes: e.sink.bytes })) };
      },
      async abort() {
        if (state === 'aborted' || state === 'closed') return;
        state = 'aborted';
        for (const e of entries) await e.sink.abort();
        if (o.parent && o.name) {
          try { await o.parent.removeEntry(o.name, { recursive: true }); } catch (err) { /* already gone, or not ours to remove */ }
          return;
        }
        for (const e of entries) {
          try { await dir.removeEntry(e.name); } catch (err) { /* removed by its sink */ }
        }
      },
    };
  }

  function canDirectory() { return typeof globalThis.showDirectoryPicker === 'function'; }

  // The names in a folder (files and folders).
  async function namesIn(dir) {
    const out = new Set();
    for await (const key of dir.keys()) out.add(key);
    return out;
  }

  // openDirectory({ name, id? }) → DirSink | null. The folder picker opens (showDirectoryPicker, read-write; call this
  // directly from the click, before any other await); null means the user closed it. In the chosen folder a new folder
  // `name` is made — or 'name (2)', 'name (3)' … when that name is taken, so nothing the user has is ever written into
  // or removed. Only where canDirectory() is true; otherwise the kit writes memory sinks and one ZIP.
  async function openDirectory(opts) {
    if (!canDirectory()) throw new S.ExportError('sink', 'this browser cannot write into a folder');
    let parent;
    try {
      parent = await globalThis.showDirectoryPicker({ mode: 'readwrite', id: (opts && opts.id) || DIRECTORY_ID });
    } catch (err) {
      if (err && err.name === 'AbortError') return null;
      throw sinkError(err);
    }
    try {
      const taken = await namesIn(parent);
      let name = opts.name;
      for (let k = 2; taken.has(name); k++) {
        if (k > MAX_NAME_TRIES) throw new Error('no free folder name for ' + opts.name);
        name = opts.name + ' (' + k + ')';
      }
      return createDirSink(await parent.getDirectoryHandle(name, { create: true }), { parent, name });
    } catch (err) {
      throw sinkError(err);
    }
  }

  const RELEASE_AFTER_MS = 60000;   // the browser reads a blob URL after click() has returned: keep it alive a while

  // A link that saves `href` as `name` when clicked.
  function saveLink(href, name) {
    const link = document.createElement('a');
    Object.assign(link, { download: name, rel: 'noopener', href });
    return link;
  }

  // downloadBlob(blob, name): saves a memory export through a link that is in the page only for its click. The object
  // URL is always released (finally), a minute later so that the download can still read it.
  function downloadBlob(blob, name) {
    const href = URL.createObjectURL(blob);
    try {
      const link = saveLink(href, name);
      document.body.append(link);
      try { link.click(); } finally { link.remove(); }
    } finally {
      setTimeout(() => URL.revokeObjectURL(href), RELEASE_AFTER_MS);
    }
  }

  return { createFileSink, createMemorySink, createDirSink, canStream, canDirectory, openSink, openDirectory, downloadBlob };
});
