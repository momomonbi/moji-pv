/* 文字PVメーカー v2 — original work. Frame-exact decode sessions: WebCodecs VideoDecoder fed from our sample tables, WebM alpha merge, ImageDecoder animations (DESIGN_2_1 §11.4.4, §11.4.10). */
MV.def('media/host/session', ['media/samples'], (SM) => {
  'use strict';

  // createVideoSession({ track, read, prefer, alpha, canvas, onHeld, onDrop }) → VideoSession
  //   track = { codec, description, codedW, codedH, w, h, rot, color, table }; read(offset, length) → Promise<Uint8Array>
  //   prefer: 'software' (export forks: bit-exact software decoders when the browser has them) | 'hardware' (preview)
  //   alpha: true → a second decoder for the WebM alpha stream (BlockAdditional id 1), merged per frame
  //   onHeld(i) / onDrop(i): called when frame i becomes held, and when a held frame i is closed (evicted; not on close())
  //   — the store bakes a hinted frame once it is held, and closes a frame's baked copies with it (§11.4.6)
  // VideoSession = {
  //   request(i, { pin }) → Promise<Held>   presentation index i; resolves when that exact frame is held
  //   held(i) → Held | null                 synchronous
  //   nearest(i) → Held | null              the nearest held frame at or before i, else the last shown one
  //   show(i)                               marks i as shown: kept until another frame is shown
  //   hint(list)                            preview look-ahead: decode these soon, lowest priority, no promise (a hinted
  //                                         frame behind the decode position waits for its request: hints never seek back;
  //                                         and a hint waits while more than HOLD frames still to be shown are held, so
  //                                         it never closes a frame about to be shown: hints resume on show())
  //   pin(set)                              frames the next draws need (export): never evicted until the next pin()
  //   pixels, failed (null | 'decode' | 'codec'), stats() → { held, decodeMs, seeks }, close()
  // }  Held = { image: VideoFrame | ImageBitmap, index, w, h (displayed px of the image), rot }
  // The chosen frame is exact by construction: chunks carry the table's timestamps (ts[d], µs) and outputs are matched
  // back to their sample by that timestamp, never by arrival order.

  const HOLD = 3;                 // frames held per session, plus the shown and pinned ones
  const AHEAD_MAX = 240;          // decode forward instead of seeking when the target is at most this many samples on
  const QUEUE_MAX = 8;            // chunks in flight
  const WINDOW = 4 * 1024 * 1024; // coalesced read window
  const STALL_MS = 10000;         // no decoder progress for this long counts as a decode error
  const SETTLE_MS = 20;           // past a hinted target: the decoder is given this long to output it before another chunk

  function mediaError(code, message) { return new SM.MediaError(code, message); }

  // The VideoDecoderConfig of a track; VP8/VP9 get no description (the vpcC box is not decoder input).
  function configOf(track, accel) {
    const c = { codec: track.codec, codedWidth: track.codedW, codedHeight: track.codedH, optimizeForLatency: false,
      hardwareAcceleration: accel };
    const cs = SM.colorSpaceOf(track.color);
    if (cs) c.colorSpace = cs;
    if (track.description && !/^vp0?[89]/.test(track.codec)) c.description = track.description;
    return c;
  }

  // The first supported configuration: software then any for 'software'; any (hardware when available) otherwise.
  async function supportedConfig(track, prefer) {
    if (typeof VideoDecoder === 'undefined') throw mediaError('noWebCodecs', 'no VideoDecoder in this browser');
    const tries = prefer === 'software' ? ['prefer-software', 'no-preference'] : ['no-preference', 'prefer-software'];
    for (const accel of tries) {
      const config = configOf(track, accel);
      try {
        const r = await VideoDecoder.isConfigSupported(config);
        if (r && r.supported) return config;
      } catch (err) { /* a malformed config: try the next, then refuse */ }
    }
    return null;
  }

  // The alpha stream's config: the same codec, size and acceleration, no colour space and no description.
  function alphaConfigOf(config) {
    return { codec: config.codec, codedWidth: config.codedWidth, codedHeight: config.codedHeight, optimizeForLatency: false,
      hardwareAcceleration: config.hardwareAcceleration };
  }

  function createVideoSession(opts) {
    const track = opts.track;
    const table = track.table;
    const read = opts.read;
    const prefer = opts.prefer === 'software' ? 'software' : 'hardware';
    const withAlpha = !!opts.alpha && !!table.aoff;
    const factory = opts.canvas || null;
    const clock = typeof opts.now === 'function' ? opts.now : () => 0;
    const onHeld = typeof opts.onHeld === 'function' ? opts.onHeld : null;
    const onDrop = typeof opts.onDrop === 'function' ? opts.onDrop : null;
    const nd = table.key.length;
    const pres = SM.presentationOf(table);
    const byTs = new Map();
    for (let d = 0; d < nd; d++) byTs.set(table.ts[d], d);
    const swap = track.rot === 90 || track.rot === 270;

    let config = null, aConfig = null;
    let decoder = null, aDecoder = null;
    let opening = null;
    let c = 0;                               // the next decode-order sample to feed
    let needSeek = true;                     // a new or flushed decoder takes a key frame first
    let output = new Uint8Array(nd);         // 1 when sample d was output since the last seek
    let errors = 0;
    let failed = null;
    let closed = false;
    const held = new Map();                  // presentation index → Held (insertion order = age)
    let shown = -1;
    let pinned = new Set();
    let current = -1;                        // the target being decoded now, or the last one decoded
    let seekFrom = 0;                        // the key frame the decoder started from at the last seek
    const waiting = new Map();               // presentation index → [{ resolve, reject }]
    let hints = [];                          // the hinted frames still to decode, in list order
    let hinted = new Set();                  // the latest hint list, whole
    const pairs = { c: new Map(), a: new Map() };   // alpha merge: timestamp → frame waiting for its partner
    const drop = new Set();                  // timestamps whose colour frame was not wanted: close the alpha too
    let win = { at: 0, bytes: new Uint8Array(0) };
    let wake = null;
    let working = false;
    let lastProgress = clock();
    const counters = { decodeMs: 0, seeks: 0, fed: 0 };

    function tick() { lastProgress = clock(); if (wake) { const w = wake; wake = null; w(); } }
    function nextTick() {
      return new Promise((resolve) => {
        wake = resolve;
        setTimeout(() => { if (wake === resolve) { wake = null; resolve(); } }, 250);
      });
    }

    // → true when `ms` pass without decoder progress (an output or a dequeue), false as soon as there is some.
    function quietFor(ms) {
      return new Promise((resolve) => {
        const w = () => resolve(false);
        wake = w;
        setTimeout(() => { if (wake === w) { wake = null; resolve(true); } }, ms);
      });
    }

    function newDecoders() {
      decoder = new VideoDecoder({ output: onColour, error: onError });
      decoder.addEventListener('dequeue', tick);
      decoder.configure(config);
      if (withAlpha) {
        aDecoder = new VideoDecoder({ output: onAlpha, error: onError });
        aDecoder.addEventListener('dequeue', tick);
        aDecoder.configure(aConfig);
      }
    }

    async function open() {
      if (!opening) {
        opening = (async () => {
          config = await supportedConfig(track, prefer);
          if (closed) return;                      // closed while the browser was asked: no decoder is ever made
          if (!config) throw mediaError('codec', 'this browser cannot decode ' + track.codec);
          if (withAlpha) aConfig = alphaConfigOf(config);
          newDecoders();
        })();
      }
      return opening;
    }

    // A frame is kept when it is asked for, pinned, or at or after the frame being decoded (sequential playback and
    // export ask for it next); anything earlier is closed at once.
    function wantedAt(i) {
      if (waiting.has(i) || pinned.has(i)) return true;
      let floor = current;
      for (const k of waiting.keys()) if (floor < 0 || k < floor) floor = k;
      return floor >= 0 && i >= floor;
    }

    function keep(i, image) {
      const prev = held.get(i);
      if (prev) closeImage(prev.image);           // the same frame decoded again: its baked copies stay valid
      held.delete(i);
      const w = image.displayWidth || image.width, h = image.displayHeight || image.height;
      held.set(i, { image, index: i, w: swap ? h : w, h: swap ? w : h, rot: track.rot || 0 });
      evict();
      const list = waiting.get(i);
      if (list) {
        waiting.delete(i);
        const got = held.get(i);
        for (const p of list) p.resolve(got);
      }
      if (onHeld && held.has(i)) { try { onHeld(i); } catch (e) { /* the store's problem */ } }
      tick();
    }

    function evict() {
      let free = 0;
      for (const i of held.keys()) if (i !== shown && !pinned.has(i) && !waiting.has(i) && i !== current) free++;
      for (const [i, h] of held) {
        if (free <= HOLD) break;
        if (i === shown || pinned.has(i) || waiting.has(i) || i === current) continue;
        closeImage(h.image);
        held.delete(i);
        free--;
        if (onDrop) { try { onDrop(i); } catch (e) { /* the store's problem */ } }
      }
    }

    // Whether a hint may be decoded now: at most HOLD frames still to be shown are held (after the shown one, or in the
    // latest hint list: a loop's start comes after its end; the last one decoded included). Decoding another then
    // leaves at most HOLD free frames besides the new one, so evict() closes none of them; with more, it would close
    // the oldest, which in playback is the next frame to be shown (the stage hints 8).
    function roomAhead() {
      let ahead = 0;
      for (const i of held.keys()) if ((i > shown || hinted.has(i)) && i !== shown && !pinned.has(i) && !waiting.has(i)) ahead++;
      return ahead <= HOLD;
    }

    function closeImage(image) { try { image.close(); } catch (err) { /* already closed */ } }

    function sampleOf(frame) {
      const d = byTs.get(frame.timestamp);
      return d === undefined ? { d: -1, i: -1 } : { d, i: pres[d] };
    }

    function onColour(frame) {
      const { d, i } = sampleOf(frame);
      if (d >= 0) output[d] = 1;
      if (closed || i < 0 || !wantedAt(i)) {
        if (withAlpha) dropAlpha(frame.timestamp);
        frame.close();
        tick();
        return;
      }
      if (!withAlpha || !(table.asize[d] > 0)) { keep(i, frame); return; }
      const a = pairs.a.get(frame.timestamp);
      if (a) { pairs.a.delete(frame.timestamp); merge(i, frame, a); } else pairs.c.set(frame.timestamp, frame);
    }

    function onAlpha(frame) {
      const ts = frame.timestamp;
      if (closed || drop.has(ts)) { drop.delete(ts); frame.close(); return; }
      const col = pairs.c.get(ts);
      if (col) {
        pairs.c.delete(ts);
        const { i } = sampleOf(col);
        merge(i, col, frame);
      } else pairs.a.set(ts, frame);
    }

    function dropAlpha(ts) {
      const a = pairs.a.get(ts);
      if (a) { pairs.a.delete(ts); a.close(); } else drop.add(ts);
    }

    // §11.4.10: the alpha frame's luma becomes the alpha of the colour frame (destination-in over a mask).
    async function merge(i, colour, alpha) {
      const t0 = clock();
      try {
        const w = colour.displayWidth, h = colour.displayHeight;
        const mask = await alphaMask(alpha);
        const out = factory ? factory.create(w, h, { alpha: true }) : { canvas: new OffscreenCanvas(w, h) };
        const ctx = out.ctx || out.canvas.getContext('2d');
        ctx.drawImage(colour, 0, 0, w, h);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(mask, 0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
        const bitmap = typeof out.canvas.transferToImageBitmap === 'function' ? out.canvas.transferToImageBitmap() : await createImageBitmap(out.canvas);
        colour.close(); alpha.close();
        counters.decodeMs += clock() - t0;
        if (closed) { bitmap.close(); return; }
        keep(i, bitmap);
      } catch (err) {
        closeImage(colour); closeImage(alpha);
        onError(err);
      }
    }

    // The alpha bytes of an alpha frame (its Y plane, 0–255 as is), as a canvas with that alpha and rgb 0.
    async function alphaMask(frame) {
      const aw = frame.visibleRect ? frame.visibleRect.width : frame.codedWidth;
      const ah = frame.visibleRect ? frame.visibleRect.height : frame.codedHeight;
      const img = new ImageData(aw, ah);
      const px = img.data;
      let done = false;
      if (frame.format) {
        try {
          const buf = new Uint8Array(frame.allocationSize());
          const layout = await frame.copyTo(buf);
          const { offset, stride } = layout[0];
          for (let y = 0; y < ah; y++) {
            const row = offset + y * stride;
            for (let x = 0; x < aw; x++) px[4 * (y * aw + x) + 3] = buf[row + x];
          }
          done = true;
        } catch (err) { /* an opaque (GPU) frame: read it through a canvas below */ }
      }
      if (!done) {
        const tmp = factory ? factory.create(aw, ah, { alpha: false }) : { canvas: new OffscreenCanvas(aw, ah) };
        const tctx = tmp.ctx || tmp.canvas.getContext('2d');
        tctx.drawImage(frame, 0, 0, aw, ah);
        const src = tctx.getImageData(0, 0, aw, ah).data;
        for (let k = 0; k < aw * ah; k++) px[4 * k + 3] = src[4 * k];
      }
      const m = factory ? factory.create(aw, ah, { alpha: true }) : { canvas: new OffscreenCanvas(aw, ah) };
      const mctx = m.ctx || m.canvas.getContext('2d');
      mctx.putImageData(img, 0, 0);
      return m.canvas;                                      // drawn scaled to the colour frame's w × h
    }

    function onError(err) {
      if (closed) return;
      errors++;
      if (errors === 1) {
        // reset once and retry from the previous key frame
        for (const dec of [decoder, aDecoder]) { try { if (dec && dec.state !== 'closed') dec.close(); } catch (e) { /* closed */ } }
        try { newDecoders(); } catch (e) { fail('decode', e); return; }
        needSeek = true;
        tick();
        return;
      }
      fail('decode', err);
    }

    function fail(code, err) {
      failed = code;
      const e = mediaError(code, 'decoding failed: ' + (err && err.message ? err.message : code));
      for (const list of waiting.values()) for (const p of list) p.reject(e);
      waiting.clear();
      tick();
    }

    // --- feeding ---------------------------------------------------------------------------------------------------

    async function bytesOf(d) {
      const from = table.off[d], to = from + table.size[d];
      if (!(from >= win.at && to <= win.at + win.bytes.length)) await loadWindow(d);
      return win.bytes.subarray(from - win.at, to - win.at);
    }

    async function alphaOf(d) {
      const from = table.aoff[d], to = from + table.asize[d];
      if (!(from >= win.at && to <= win.at + win.bytes.length)) await loadWindow(d);
      return win.bytes.subarray(from - win.at, to - win.at);
    }

    // A window from sample d on: every following sample (and its alpha payload) while the span stays within 4 MB.
    async function loadWindow(d) {
      const lo = (k) => (withAlpha && table.asize[k] > 0 ? Math.min(table.off[k], table.aoff[k]) : table.off[k]);
      const hi = (k) => (withAlpha && table.asize[k] > 0 ? Math.max(table.off[k] + table.size[k], table.aoff[k] + table.asize[k]) : table.off[k] + table.size[k]);
      const start = lo(d);
      let end = hi(d);
      for (let k = d + 1; k < nd; k++) {
        if (lo(k) < start || hi(k) - start > WINDOW) break;
        end = Math.max(end, hi(k));
      }
      const bytes = await read(start, end - start);
      if (!bytes || bytes.length < end - start) throw mediaError('broken', 'the file ends early');
      win = { at: start, bytes };
    }

    // Waits while `limit` or more chunks are in flight (limit 0: until the decoders have taken every chunk).
    async function room(limit) {
      const busy = () => decoder.decodeQueueSize >= Math.max(1, limit) || (aDecoder && aDecoder.decodeQueueSize >= Math.max(1, limit));
      while (!closed && !failed && !needSeek && busy()) {
        await nextTick();
        stallCheck();
      }
    }

    function stallCheck() {
      if (clock() - lastProgress > STALL_MS) { lastProgress = clock(); onError(new Error('the decoder stopped making progress')); }
    }

    async function feed(d) {
      const data = await bytesOf(d);
      const type = table.key[d] ? 'key' : 'delta';
      decoder.decode(new EncodedVideoChunk({ type, timestamp: table.ts[d], data }));
      if (withAlpha && table.asize[d] > 0) aDecoder.decode(new EncodedVideoChunk({ type, timestamp: table.ts[d], data: await alphaOf(d) }));
      counters.fed++;
    }

    function seek(from) {
      counters.seeks++;
      for (const dec of [decoder, aDecoder]) if (dec && dec.state === 'configured') dec.reset();
      for (const dec of [decoder, aDecoder]) if (dec) dec.configure(dec === decoder ? config : aConfig);
      for (const f of pairs.c.values()) f.close();
      for (const f of pairs.a.values()) f.close();
      pairs.c.clear(); pairs.a.clear(); drop.clear();
      output = new Uint8Array(nd);
      c = from;
      seekFrom = from;
      needSeek = false;
    }

    async function flush() {
      try {
        await Promise.all([decoder.flush(), aDecoder ? aDecoder.flush() : null]);
      } catch (err) { /* a reset or an error interrupted it; the loop re-checks */ }
      needSeek = true;                         // after a flush the next chunk must be a key frame
    }

    // Decodes until presentation frame i is held (or the session fails). §11.4.4 step 2: keep feeding forward when the
    // target is at most AHEAD_MAX samples on (through the key frame at `from` if needed), wait when it was fed and is
    // still in the decoder, and seek otherwise. Up to the target the queue holds 8 chunks; after it, one more chunk
    // at a time and only when the decoder has taken the previous ones, so hardly any frame after the target comes out
    // (and is closed) before it is asked for. A hinted target (`isHint`: the look-ahead, nobody waits for it) is more
    // careful still: past it, another chunk only once the decoder has shown no progress for SETTLE_MS (it needs more
    // input: reordered frames), because every frame it outputs past the target is held and, beyond HOLD, closes the
    // oldest held one — in playback the next to be shown; and it gives way to a request at once.
    async function ensure(i, isHint) {
      const t0 = clock();
      current = i;
      const { from, to } = SM.runFor(table, i);
      if (needSeek || output[to] || from < seekFrom || (c <= to && to - c > AHEAD_MAX)) seek(from);
      let flushedAt = -1;
      while (!closed && !failed && !held.has(i)) {
        if (isHint && waiting.size) break;             // a request goes first; the stage hints this frame again
        if (needSeek) { seek(from); continue; }
        if (c < nd) {
          await room(c <= to ? QUEUE_MAX : 0);
          if (closed || failed || held.has(i) || needSeek) continue;
          if (isHint && c > to && !(await quietFor(SETTLE_MS))) continue;
          if (closed || failed || held.has(i) || needSeek || (isHint && waiting.size)) continue;
          await feed(c);
          c++;
          continue;
        }
        if (flushedAt === c) throw mediaError('decode', 'frame ' + i + ' did not decode');
        flushedAt = c;
        await flush();
        if (!held.has(i)) { await nextTick(); if (!held.has(i)) throw mediaError('decode', 'frame ' + i + ' did not decode'); }
      }
      counters.decodeMs += clock() - t0;
    }

    function nextTarget() {
      let best = -1;
      for (const i of waiting.keys()) if (best < 0 || i < best) best = i;
      if (best >= 0) return best;
      while (hints.length) {
        const i = hints[0];
        if (held.has(i) || behind(i)) { hints.shift(); continue; }
        if (!roomAhead()) return -1;               // resumed by show()
        hints.shift();
        return i;
      }
      return -1;
    }

    // A look-ahead hint never sends the decoder back: a frame behind the decode position (output since the last seek
    // and closed, or in a GOP before the one the decoder started from) is decoded when it is requested, not hinted.
    // Otherwise the look-ahead of a loop's first frame resets the decoder under the frames about to be drawn, which
    // are then decoded again from their key frame (a 1080p export stalled ≈ 150 ms at every loop of a one-GOP clip).
    function behind(i) {
      if (needSeek) return false;
      const { from, to } = SM.runFor(table, i);
      return output[to] === 1 || from < seekFrom;
    }

    async function work() {
      if (working) return;
      working = true;
      try {
        await open();
        while (!closed && !failed) {
          const i = nextTarget();
          if (i < 0) break;
          if (held.has(i)) { keepWaiting(i); continue; }
          try {
            await ensure(i, !waiting.has(i));
          } catch (err) {
            if (err && err.code === 'decode' && !failed) fail('decode', err);
            else if (!failed) fail(err && err.code ? err.code : 'decode', err);
          }
          keepWaiting(i);
        }
      } catch (err) {
        fail(err && err.code ? err.code : 'decode', err);
      } finally {
        working = false;
      }
    }

    function keepWaiting(i) {
      const list = waiting.get(i);
      const got = held.get(i);
      if (list && got) { waiting.delete(i); for (const p of list) p.resolve(got); }
    }

    function request(i, o) {
      if (closed) return Promise.reject(mediaError('closed', 'session closed'));
      if (failed) return Promise.reject(mediaError(failed, 'decoding failed'));
      const k = Math.max(0, Math.min(table.n - 1, i | 0));
      if (o && o.pin) pinned.add(k);
      const got = held.get(k);
      if (got) return Promise.resolve(got);
      return new Promise((resolve, reject) => {
        if (!waiting.has(k)) waiting.set(k, []);
        waiting.get(k).push({ resolve, reject });
        work();
      });
    }

    return {
      get pixels() { return track.codedW * track.codedH; },
      get failed() { return failed; },
      request,
      held(i) { return held.get(i) || null; },
      nearest(i) {
        let best = null;
        for (const h of held.values()) if (h.index <= i && (!best || h.index > best.index)) best = h;
        return best || held.get(shown) || null;
      },
      show(i) {
        if (!held.has(i)) return;
        shown = i;
        evict();
        if (hints.length && !closed && !failed) work();
      },
      hint(list) {
        const all = (list || []).filter((i) => Number.isInteger(i) && i >= 0 && i < table.n);
        hinted = new Set(all);
        hints = all.filter((i) => !held.has(i));
        if (hints.length) work();
      },
      pin(set) { pinned = new Set(set || []); evict(); },
      stats() { return { held: held.size, decodeMs: counters.decodeMs, seeks: counters.seeks, fed: counters.fed }; },
      close() {
        if (closed) return;
        closed = true;
        for (const h of held.values()) closeImage(h.image);
        held.clear();
        for (const f of pairs.c.values()) f.close();
        for (const f of pairs.a.values()) f.close();
        for (const dec of [decoder, aDecoder]) { try { if (dec && dec.state !== 'closed') dec.close(); } catch (e) { /* closed */ } }
        const e = mediaError('closed', 'session closed');
        for (const list of waiting.values()) for (const p of list) p.reject(e);
        waiting.clear();
        tick();
      },
    };
  }

  // createAnimSession({ blob, mime, table, capBytes, onHeld, onDrop }) → the same interface over ImageDecoder: random
  // access by frame index, decoded frames kept as ImageBitmaps in an LRU of capBytes (64 MB).
  function createAnimSession(opts) {
    const table = opts.table;
    const onHeld = typeof opts.onHeld === 'function' ? opts.onHeld : null;
    const onDrop = typeof opts.onDrop === 'function' ? opts.onDrop : null;
    const cap = opts.capBytes || 64 * 1024 * 1024;
    const cache = new Map();                 // frame → Held (insertion order = LRU order)
    const pending = new Map();
    let bytes = 0;
    let decoder = null;
    let failed = null;
    let closed = false;
    let shown = -1;
    let pinned = new Set();
    let chain = Promise.resolve();
    const counters = { decodeMs: 0 };

    function dec() {
      if (!decoder) {
        if (typeof ImageDecoder === 'undefined') throw mediaError('noWebCodecs', 'no ImageDecoder');
        decoder = new ImageDecoder({ data: opts.blob.stream(), type: opts.mime });
      }
      return decoder;
    }

    function evict() {
      for (const [i, h] of cache) {
        if (bytes <= cap) break;
        if (i === shown || pinned.has(i)) continue;
        cache.delete(i);
        bytes -= h.w * h.h * 4;
        try { h.image.close(); } catch (e) { /* closed */ }
        if (onDrop) { try { onDrop(i); } catch (e) { /* the store's problem */ } }
      }
    }

    function request(i, o) {
      const k = Math.max(0, Math.min(table.n - 1, i | 0));
      if (o && o.pin) pinned.add(k);
      if (cache.has(k)) { const h = cache.get(k); cache.delete(k); cache.set(k, h); return Promise.resolve(h); }
      if (closed) return Promise.reject(mediaError('closed', 'session closed'));
      if (failed) return Promise.reject(mediaError(failed, 'decoding failed'));
      if (pending.has(k)) return pending.get(k);
      const job = (chain = chain.then(async () => {
        const t0 = typeof opts.now === 'function' ? opts.now() : 0;
        const r = await dec().decode({ frameIndex: k, completeFramesOnly: true });
        const bitmap = await createImageBitmap(r.image);
        r.image.close();
        counters.decodeMs += (typeof opts.now === 'function' ? opts.now() : 0) - t0;
        if (closed) { bitmap.close(); throw mediaError('closed', 'session closed'); }
        const h = { image: bitmap, index: k, w: bitmap.width, h: bitmap.height, rot: 0 };
        cache.set(k, h);
        bytes += h.w * h.h * 4;
        evict();
        if (onHeld && cache.has(k)) { try { onHeld(k); } catch (e) { /* the store's problem */ } }
        return h;
      }).catch((err) => {
        if (!closed && (!err || err.code !== 'closed')) failed = 'decode';
        throw err && err.code ? err : mediaError('decode', String(err && err.message));
      }).finally(() => pending.delete(k)));
      pending.set(k, job);
      return job;
    }

    return {
      get pixels() { return 0; },
      get failed() { return failed; },
      request,
      held(i) { return cache.get(i) || null; },
      nearest(i) {
        let best = null;
        for (const h of cache.values()) if (h.index <= i && (!best || h.index > best.index)) best = h;
        return best || cache.get(shown) || null;
      },
      show(i) { if (cache.has(i)) shown = i; },
      hint(list) { for (const i of (list || []).slice(0, 4)) if (!cache.has(i)) request(i).catch(() => {}); },
      pin(set) { pinned = new Set(set || []); evict(); },
      stats() { return { held: cache.size, decodeMs: counters.decodeMs, seeks: 0, fed: 0 }; },
      close() {
        closed = true;
        for (const h of cache.values()) { try { h.image.close(); } catch (e) { /* closed */ } }
        cache.clear();
        if (decoder) { try { decoder.close(); } catch (e) { /* closed */ } }
      },
    };
  }

  return { createVideoSession, createAnimSession, supportedConfig, configOf, HOLD, AHEAD_MAX, QUEUE_MAX };
});
