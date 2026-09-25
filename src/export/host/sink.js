/* 文字PVメーカー v2 — original work. Export sinks: a file on disk (File System Access) or memory with a download (§4.21). */
MV.def('export/host/sink', ['export/schedule'], (S) => {
  'use strict';

  const TYPES = Object.freeze({
    mp4: { description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } },
    zip: { description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } },
  });

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

  // openSink({ name, kind: 'mp4' | 'zip' }) → Sink | null. With File System Access the save dialog opens (call this
  // directly from the click, before any other await); null means the user closed the dialog. Otherwise a memory sink.
  async function openSink(opts) {
    const kind = opts.kind === 'zip' ? 'zip' : 'mp4';
    const type = kind === 'zip' ? 'application/zip' : 'video/mp4';
    if (!canStream()) return createMemorySink({ name: opts.name, type });
    try {
      const handle = await globalThis.showSaveFilePicker({ suggestedName: opts.name, types: [TYPES[kind]] });
      return createFileSink(handle);
    } catch (err) {
      if (err && err.name === 'AbortError') return null;
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

  return { createFileSink, createMemorySink, canStream, openSink, downloadBlob };
});
