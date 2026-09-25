/* 文字PVメーカー v2 — original work. The real AssetStore: still tiers, decode sessions per fork, provisional frames for the preview, exact frames for export (DESIGN_2_1 §11.3.6, §11.4.5–§11.4.7). */
MV.def('media/host/store', ['core/media', 'media/samples', 'media/host/session', 'media/host/probe'], (MEDIA, SM, SES, PR) => {
  'use strict';

  // createMediaStore({ blobs, entries, canvas, now, idle, prefer }) → AssetStore (§11.3.6), plus check(ids).
  //   blobs = { get(id) → Promise<Blob | null>, index(id) → Promise<{ v, table, track } | null>,
  //             thumbs(id) → Promise<{ v, poster, strip } | null>, putIndex?(id, rec), putThumbs?(id, rec) }
  //           (ui/project_io's device store: IndexedDB, or the in-memory fallback)
  //   entries(id) → AssetEntry | null   the document's metadata (doc.media); w, h, kind and anim come from it
  //   prefer: 'hardware' for the preview (the default here), 'software' for export forks (fork() uses it)
  // Media time m picks the source frame with media/samples.sampleAt; the preview may get a provisional frame
  // (exact: false: the nearest held frame, the last shown one, a filmstrip tile or the poster) while the exact one
  // decodes, and a 'ready' event follows. Export calls ready() first, so every frame() it makes is exact.

  const STILL_BUDGET = 320 * 1024 * 1024;          // §11.4.7: still bitmaps, blurred copies included
  const SESSION_PIXELS = 16.6e6;                   // Σ coded pixels of the open sessions of one store
  const BLUR_LEVELS = [0, 2, 4, 8, 16, 32, 64, 128];

  // The blur level (device px) a request uses: the nearest level, so cached copies are reused.
  function blurLevel(px) {
    const v = typeof px === 'number' && px > 0 ? px : 0;
    let best = 0;
    for (const lv of BLUR_LEVELS) if (Math.abs(lv - v) < Math.abs(best - v)) best = lv;
    return best;
  }

  function mediaError(code, message, detail) { return new SM.MediaError(code, message || code, detail); }

  function createShared(o) {
    return {
      blobs: o.blobs, entries: typeof o.entries === 'function' ? o.entries : () => null, canvas: o.canvas || null,
      now: typeof o.now === 'function' ? o.now : () => 0, idle: o.idle,
      blob: new Map(),            // id → { p: Promise<Blob | null>, value: Blob | null | undefined }
      index: new Map(),           // id → { p, value: { table, track } | null | undefined, error }
      thumbs: new Map(),          // id → { p, value: { poster, tiles, picks } | null | undefined }
      stills: new Map(),          // key → { bitmap, w, h, bytes } (Map order = least recently used first)
      stillP: new Map(),          // key → Promise
      stillBytes: 0,
      failed: new Map(),          // id → code: an asset that cannot be read or decoded here
      stores: new Set(),
    };
  }

  function createMediaStore(opts) {
    return storeOver(createShared(opts || {}), (opts && opts.prefer) === 'software' ? 'software' : 'hardware', true);
  }

  function storeOver(shared, prefer, root) {
    const sessions = new Map();                  // id → session (Map order = least recently used first)
    const frames = new Map();                    // id → the pooled MediaFrame
    const listeners = { ready: new Set(), state: new Set() };
    const lastPx = new Map();
    let decodeMs = 0;
    let disposed = false;

    function emit(event, arg) {
      for (const store of shared.stores) for (const fn of store.listeners[event]) { try { fn(arg); } catch (e) { /* a listener's problem */ } }
    }

    // --- bytes, index and thumbs (shared by every fork) ---------------------------------------------------------

    function loadBlob(id) {
      let rec = shared.blob.get(id);
      if (!rec) {
        rec = { p: null, value: undefined };
        shared.blob.set(id, rec);
        rec.p = Promise.resolve().then(() => shared.blobs.get(id)).then((b) => b || null, () => null).then((b) => {
          rec.value = b;
          emit('state', { id });
          return b;
        });
      }
      return rec;
    }

    function blobNow(id) { return loadBlob(id).value; }

    function loadIndex(id) {
      let rec = shared.index.get(id);
      if (!rec) {
        rec = { p: null, value: undefined, error: null };
        shared.index.set(id, rec);
        rec.p = (async () => {
          const blob = await loadBlob(id).p;
          if (!blob) return null;
          let got = null;
          try {
            const stored = shared.blobs.index ? await shared.blobs.index(id) : null;
            const table = stored && stored.v === MEDIA.INDEX_V ? SM.fromData(stored.table) : null;
            if (table && stored.track) got = { table, track: stored.track };
          } catch (e) { got = null; }
          if (!got) {
            const e = shared.entries(id);
            const anim = e ? e.anim === true : false;
            const built = anim ? await PR.animIndexOf(blob, e.mime) : await PR.indexOf(blob);
            got = { table: built.table, track: built.track };
            if (shared.blobs.putIndex) {
              try { await shared.blobs.putIndex(id, { v: MEDIA.INDEX_V, table: SM.toData(built.table), track: built.track }); } catch (e2) { /* a cache */ }
            }
          }
          return got;
        })().then((v) => { rec.value = v; emit('ready', { id }); return v; }, (err) => {
          rec.value = null;
          rec.error = err;
          shared.failed.set(id, err && err.code ? err.code : 'broken');
          emit('state', { id });
          return null;
        });
      }
      return rec;
    }

    function loadThumbs(id) {
      let rec = shared.thumbs.get(id);
      if (!rec) {
        rec = { p: null, value: undefined };
        shared.thumbs.set(id, rec);
        rec.p = (async () => {
          let stored = null;
          try { stored = shared.blobs.thumbs ? await shared.blobs.thumbs(id) : null; } catch (e) { stored = null; }
          if (!stored || !stored.poster) {
            const blob = await loadBlob(id).p;
            if (!blob) return null;
            const store = { getThumbs: async () => null, getMedia: async () => ({ blob }),
              putThumbs: async (k, r) => { if (shared.blobs.putThumbs) await shared.blobs.putThumbs(k, r); } };
            stored = await PR.thumbsOf(id, { store, canvas: shared.canvas });
            if (!stored) return null;
          }
          const poster = await createImageBitmap(stored.poster);
          let tiles = [];
          if (stored.strip) {
            const sprite = await createImageBitmap(stored.strip);
            const n = stored.tiles || PR.STRIP;
            const tw = Math.floor(sprite.width / n);
            for (let k = 0; k < n; k++) tiles.push(await createImageBitmap(sprite, k * tw, 0, tw, sprite.height));
            sprite.close();
          }
          return { poster, tiles };
        })().then((v) => { rec.value = v; if (v) emit('ready', { id }); return v; }, () => { rec.value = null; return null; });
      }
      return rec;
    }

    // --- stills ------------------------------------------------------------------------------------------------------

    function stillKey(id, tier, level) { return id + '|' + tier + '|' + level; }

    function touchStill(key) {
      const hit = shared.stills.get(key);
      if (hit) { shared.stills.delete(key); shared.stills.set(key, hit); }
      return hit || null;
    }

    function putStill(key, rec) {
      shared.stills.set(key, rec);
      shared.stillBytes += rec.bytes;
      for (const [k, r] of shared.stills) {
        if (shared.stillBytes <= STILL_BUDGET) break;
        if (k === key) continue;
        shared.stills.delete(k);
        shared.stillBytes -= r.bytes;
        try { r.bitmap.close(); } catch (e) { /* closed */ }
      }
    }

    // Decodes a still at `tier` px on the long side (EXIF orientation applied, colour converted to sRGB), and its
    // blurred copy at `level` when asked: downscaled by max(1, level / 4) and filtered in the host (§11.4.6).
    function decodeStill(id, entry, tier, level) {
      const key = stillKey(id, tier, level);
      if (shared.stills.has(key)) return Promise.resolve(shared.stills.get(key));
      if (shared.stillP.has(key)) return shared.stillP.get(key);
      const t0 = shared.now();
      const p = (async () => {
        if (level > 0) {
          const base = await decodeStill(id, entry, tier, 0);
          const k = Math.max(1, level / 4);
          const w = Math.max(1, Math.round(base.w / k)), h = Math.max(1, Math.round(base.h / k));
          const s = shared.canvas ? shared.canvas.create(w, h, { alpha: true }) : (() => { const c = new OffscreenCanvas(w, h); return { canvas: c, ctx: c.getContext('2d') }; })();
          s.ctx.filter = 'blur(' + (level / k) + 'px)';
          s.ctx.drawImage(base.bitmap, 0, 0, w, h);
          s.ctx.filter = 'none';
          const bitmap = typeof s.canvas.transferToImageBitmap === 'function' ? s.canvas.transferToImageBitmap() : await createImageBitmap(s.canvas);
          return { bitmap, w: entry.w, h: entry.h, bytes: w * h * 4 };
        }
        const blob = await loadBlob(id).p;
        if (!blob) throw mediaError('missing', 'not on this device', { id });
        const long = Math.max(entry.w, entry.h);
        const rw = Math.max(1, Math.round((entry.w * tier) / long)), rh = Math.max(1, Math.round((entry.h * tier) / long));
        let bitmap;
        try {
          bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image', colorSpaceConversion: 'default', premultiplyAlpha: 'default',
            resizeWidth: rw, resizeHeight: rh, resizeQuality: 'high' });
        } catch (e) {
          try { bitmap = await createImageBitmap(blob, { resizeWidth: rw, resizeHeight: rh, resizeQuality: 'high' }); } catch (e2) {
            throw mediaError('broken', 'the image does not decode');
          }
        }
        return { bitmap, w: entry.w, h: entry.h, bytes: rw * rh * 4 };
      })().then((rec) => {
        shared.stillP.delete(key);
        decodeMs += shared.now() - t0;
        if (!shared.stills.has(key)) putStill(key, rec);
        emit('ready', { id });
        return shared.stills.get(key);
      }, (err) => {
        shared.stillP.delete(key);
        if (err && err.code === 'broken') { shared.failed.set(id, 'broken'); emit('state', { id }); }
        throw err;
      });
      shared.stillP.set(key, p);
      return p;
    }

    // --- sessions (per store) ---------------------------------------------------------------------------------------------

    function sessionFor(id, entry) {
      let s = sessions.get(id);
      if (s) { sessions.delete(id); sessions.set(id, s); return s; }
      const idx = loadIndex(id).value, blob = blobNow(id);
      if (!idx || !blob) return null;
      if (entry.anim || idx.track.anim) {
        s = SES.createAnimSession({ blob, mime: entry.mime, table: idx.table, now: shared.now });
      } else {
        s = SES.createVideoSession({ track: PR.sessionTrack(idx.table, idx.track), read: PR.blobReader(blob), prefer,
          alpha: !!idx.track.alpha && entry.alpha !== false, canvas: shared.canvas, now: shared.now });
      }
      sessions.set(id, s);
      let total = 0;
      for (const x of sessions.values()) total += x.pixels;
      for (const [k, x] of sessions) {
        if (total <= SESSION_PIXELS || sessions.size <= 1) break;
        if (k === id) continue;
        total -= x.pixels;
        decodeMs += x.stats().decodeMs;
        x.close();
        sessions.delete(k);
      }
      return s;
    }

    function sessionFailed(id, s) {
      if (s && s.failed) {
        shared.failed.set(id, s.failed === 'codec' || s.failed === 'noWebCodecs' ? s.failed : 'decode');
        emit('state', { id });
      }
    }

    // --- frames ----------------------------------------------------------------------------------------------------------

    function mf(id, image, w, h, rot, exact, index) {
      let f = frames.get(id);
      if (!f) { f = { image: null, w: 0, h: 0, rot: 0, exact: false, index: 0 }; frames.set(id, f); }
      f.image = image; f.w = w; f.h = h; f.rot = rot; f.exact = exact; f.index = index;
      return f;
    }

    function posterFrame(id, exact) {
      const t = loadThumbs(id).value;
      if (!t || !t.poster) return null;
      return mf(id, t.poster, t.poster.width, t.poster.height, 0, exact, 0);
    }

    function isTimed(entry) { return entry.kind === 'video' || entry.anim === true; }

    function frame(id, m, want) {
      if (disposed || !MEDIA.isId(id)) return null;
      const entry = shared.entries(id);
      if (!entry) return null;
      const w = want || {};
      if (blobNow(id) === null || shared.failed.has(id)) return null;
      if (blobNow(id) === undefined) { loadBlob(id); return isTimed(entry) || w.thumb ? posterFrame(id, false) : null; }
      if (w.thumb) return posterFrame(id, true) || (isTimed(entry) ? null : stillFrame(id, entry, w));
      return isTimed(entry) ? timedFrame(id, entry, m, w) : stillFrame(id, entry, w);
    }

    function stillFrame(id, entry, w) {
      const px = w.px > 0 ? w.px : Math.max(entry.w, entry.h);
      lastPx.set(id, Math.max(lastPx.get(id) || 0, px));
      const tier = MEDIA.tier(px, entry), level = blurLevel(w.blur);
      const hit = touchStill(stillKey(id, tier, level));
      if (hit) return mf(id, hit.bitmap, hit.bitmap.width, hit.bitmap.height, 0, true, 0);
      decodeStill(id, entry, tier, level).catch(() => {});
      let best = null;
      for (const [k, r] of shared.stills) if (k.startsWith(id + '|') && (!best || r.bitmap.width > best.bitmap.width)) best = r;
      if (best) return mf(id, best.bitmap, best.bitmap.width, best.bitmap.height, 0, false, 0);
      loadThumbs(id);
      return posterFrame(id, false);
    }

    function timedFrame(id, entry, m, w) {
      const idx = loadIndex(id);
      if (!idx.value) { loadThumbs(id); return posterFrame(id, false); }
      const table = idx.value.table;
      const i = SM.sampleAt(table, typeof m === 'number' && Number.isFinite(m) ? m : 0);
      const s = sessionFor(id, entry);
      if (!s) return posterFrame(id, false);
      const h = s.held(i);
      if (h) { s.show(i); return mf(id, h.image, h.w, h.h, h.rot, true, i); }
      s.request(i).then(() => emit('ready', { id }), () => sessionFailed(id, s));
      const near = s.nearest(i);
      if (near) return mf(id, near.image, near.w, near.h, near.rot, false, near.index);
      const t = loadThumbs(id).value;
      if (t && t.tiles.length) {
        const picks = PR.stripPicks(table, entry.anim === true || idx.value.track.anim);
        let k = 0;
        for (let j = 0; j < picks.length; j++) if (picks[j] <= i) k = j;
        const tile = t.tiles[Math.min(k, t.tiles.length - 1)];
        return mf(id, tile, tile.width, tile.height, 0, false, picks[k]);
      }
      return posterFrame(id, false);
    }

    function want(list) {
      if (disposed) return;
      const byId = new Map();
      for (const item of list || []) {
        if (!item || !MEDIA.isId(item.id)) continue;
        const entry = shared.entries(item.id);
        if (!entry || !isTimed(entry)) continue;
        const idx = loadIndex(item.id);
        if (!idx.value) continue;
        if (!byId.has(item.id)) byId.set(item.id, []);
        byId.get(item.id).push(SM.sampleAt(idx.value.table, item.m || 0));
      }
      for (const [id, indices] of byId) {
        const s = sessionFor(id, shared.entries(id));
        if (s) s.hint(indices);
      }
    }

    // ready(list, { signal }) → resolves when every exact frame is held. Items are { id, m } and, for stills, may carry
    // { px, blur } (the tier the draw will ask for); without px a still decodes at the largest need seen, else full size.
    async function ready(list, o) {
      const signal = o && o.signal;
      const jobs = [];
      const pins = new Map();
      for (const item of list || []) {
        if (!item || !MEDIA.isId(item.id)) continue;
        const id = item.id;
        const entry = shared.entries(id);
        if (!entry) throw mediaError('missing', 'not in the library', { id });
        jobs.push((async () => {
          const blob = await loadBlob(id).p;
          if (!blob) throw mediaError('missing', 'not on this device', { id });
          if (!isTimed(entry)) {
            const px = item.px > 0 ? item.px : lastPx.get(id) || Math.max(entry.w, entry.h);
            await decodeStill(id, entry, MEDIA.tier(px, entry), blurLevel(item.blur));
            return;
          }
          const idx = await loadIndex(id).p;
          if (!idx) throw mediaError(shared.failed.get(id) || 'broken', 'no sample table', { id });
          const i = SM.sampleAt(idx.table, item.m || 0);
          if (!pins.has(id)) pins.set(id, new Set());
          pins.get(id).add(i);
          const s = sessionFor(id, entry);
          s.pin(pins.get(id));
          try { await s.request(i, { pin: true }); } catch (err) { sessionFailed(id, s); throw err; }
        })());
      }
      const all = Promise.all(jobs);
      if (!signal) { await all; return; }
      if (signal.aborted) throw abortError();
      await new Promise((resolve, reject) => {
        const onAbort = () => reject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
        all.then((v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
          (e) => { signal.removeEventListener('abort', onAbort); reject(e); });
      });
    }

    function abortError() { const e = new Error('cancelled'); e.name = 'AbortError'; return e; }

    function has(id) { return blobNow(id) instanceof Object; }

    function info(id) {
      if (shared.failed.has(id)) return { state: 'error', code: shared.failed.get(id) };
      const b = loadBlob(id).value;
      if (b === undefined) return { state: 'loading' };
      if (b === null) return { state: 'missing' };
      return { state: 'ok' };
    }

    // check(ids) → Promise: loads presence for these ids, so has() and info() answer at once afterwards (additive).
    async function check(ids) { await Promise.all((ids || []).filter(MEDIA.isId).map((id) => loadBlob(id).p)); }

    // get(id): the v2.0 member — a still at its largest cached tier (starts a full-size decode when none is cached).
    function get(id) {
      let best = null;
      for (const [k, r] of shared.stills) if (k.startsWith(id + '|') && k.endsWith('|0') && (!best || r.bitmap.width > best.bitmap.width)) best = r;
      if (best) return best.bitmap;
      const entry = shared.entries(id);
      if (entry && !isTimed(entry) && blobNow(id)) decodeStill(id, entry, MEDIA.tier(Infinity, entry), 0).catch(() => {});
      else if (entry) loadBlob(id);
      return null;
    }

    // forget(id): drops the cached state of one id (after a relink stores new bytes, or a clear); additive.
    function forget(id) {
      shared.blob.delete(id); shared.index.delete(id); shared.thumbs.delete(id); shared.failed.delete(id);
      for (const store of shared.stores) store.dropSession(id);
      for (const [k, r] of shared.stills) {
        if (!k.startsWith(id + '|')) continue;
        shared.stills.delete(k); shared.stillBytes -= r.bytes;
        try { r.bitmap.close(); } catch (e) { /* closed */ }
      }
      emit('state', { id });
    }

    const api = {
      get, frame, want, ready, has, info, check, forget,
      on(event, fn) {
        const set = listeners[event];
        if (!set || typeof fn !== 'function') return () => {};
        set.add(fn);
        return () => set.delete(fn);
      },
      fork(o) { return storeOver(shared, (o && o.prefer) || 'software', false); },
      stats() {
        let pixels = 0, held = 0, ms = decodeMs;
        for (const s of sessions.values()) { pixels += s.pixels; const st = s.stats(); held += st.held; ms += st.decodeMs; }
        return { stillBytes: shared.stillBytes, sessions: sessions.size, sessionPixels: pixels, held, decodeMs: ms };
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const s of sessions.values()) s.close();
        sessions.clear();
        frames.clear();
        shared.stores.delete(internal);
        if (root) {
          for (const r of shared.stills.values()) { try { r.bitmap.close(); } catch (e) { /* closed */ } }
          shared.stills.clear();
          shared.stillBytes = 0;
        }
      },
    };
    const internal = { listeners, dropSession(id) { const s = sessions.get(id); if (s) { s.close(); sessions.delete(id); } } };
    shared.stores.add(internal);
    return api;
  }

  return { createMediaStore, blurLevel, STILL_BUDGET, SESSION_PIXELS, BLUR_LEVELS };
});
