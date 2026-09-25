/* 文字PVメーカー v2 — original work. PNG sequence export: engine fork → PNG frames → store-only ZIP → sink (§4.21). */
MV.def('export/host/png', ['export/schedule', 'export/zip', 'export/host/mp4'], (S, Z, J) => {
  'use strict';

  const PIPELINE = 4;               // PNG encodes in flight: frame i + 1 renders while frame i is still being compressed

  // encodePng(canvas) → Promise<Uint8Array>. The canvas is snapshotted when this is called, so the caller may draw the
  // next frame at once.
  function encodePng(canvas) {
    const blob = typeof canvas.convertToBlob === 'function' ? canvas.convertToBlob({ type: 'image/png' })
      : new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
    return blob.then((b) => b.arrayBuffer()).then((buf) => new Uint8Array(buf));
  }

  function zipDate(d) {
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(),
      second: d.getSeconds() };
  }

  // exportPngs({ engine, doc, alpha, sink, signal, onProgress, canvas? }) → Result { bytes, frames, ms, name, blob? }.
  // Frames go into a ZIP as '<name>_00000.png' …; `alpha` renders with the transparent backdrop (RGBA PNGs). Cancel or
  // failure aborts the sink (no partial file).
  async function exportPngs(opts) {
    const o = opts || {};
    const started = performance.now();
    const sink = o.sink;
    const inflight = [];
    let job = null;
    try {
      job = await J.openJob({ engine: o.engine, doc: o.doc, format: o.alpha ? 'pngAlpha' : 'png', canvas: o.canvas });
      const base = S.fileName(o.doc, 'zip').slice(0, -'.zip'.length);
      const zip = Z.createZip((bytes) => sink.write(bytes), { date: zipDate(new Date()) });
      const progress = J.createProgress(job.N, o.onProgress);
      let next = 0;
      const drainOne = async () => {
        const bytes = await inflight.shift();
        await zip.add(S.frameName(base, next, job.N), bytes);
        progress.frame(next);
        next++;
      };
      for (let i = 0; i < job.N; i++) {
        J.checkAbort(o.signal);
        await job.ready(i, o.signal);
        job.render(i);
        inflight.push(encodePng(job.surface.canvas));
        if (inflight.length >= PIPELINE) await drainOne();
      }
      while (inflight.length) {
        J.checkAbort(o.signal);
        await drainOne();
      }
      await zip.finish();
      const done = await sink.close();
      return { bytes: done.bytes, frames: job.N, ms: performance.now() - started, name: sink.name || S.fileName(o.doc, 'zip'),
        blob: done.blob };
    } catch (err) {
      for (const p of inflight) p.catch(() => {});
      await sink.abort();
      if (err instanceof S.ExportError) throw err;
      if (o.signal && o.signal.aborted) throw new S.ExportError('cancelled', 'export cancelled');
      throw new S.ExportError(err && err.code === 'sink' ? 'sink' : 'encode', (err && err.message) || 'export failed', err);
    } finally {
      if (job) job.engine.dispose();
    }
  }

  return { exportPngs, encodePng };
});
