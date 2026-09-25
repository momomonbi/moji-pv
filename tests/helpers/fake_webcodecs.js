/* 文字PVメーカー v2 — original work. Test helper: WebCodecs, ImageBitmap and canvas stand-ins, so the real media store, its decode sessions and the import probe run in Node (media/host/store, session, probe). */
'use strict';

// install({ delay, configDelay }) puts VideoDecoder, EncodedVideoChunk, VideoFrame and createImageBitmap on globalThis
// (Node has none of them) and returns { settings, counts, canvas, bitmaps, VideoFrame }:
//   settings       { delay, configDelay }, read at each call (a test may change them)
//   VideoDecoder   outputs one VideoFrame per chunk, `delay` ms after decode() (default 1), in decode order, with the
//                  chunk's timestamp and the configured coded size; flush() waits for the queue; reset() and close()
//                  drop what is in flight. isConfigSupported answers after `configDelay` ms (default 0).
//   counts         { decoders (made), configured (configure() calls), closedDecoders, frames (made), liveFrames }
//   canvas         a CanvasFactory (create(w, h) → { canvas, ctx }) whose contexts record every drawImage as
//                  { image, args, filter } in canvas.draws, and every canvas made in canvas.made
//   bitmaps        every ImageBitmap createImageBitmap made: { width, height, source, closed }
// Each Node test file runs in its own process, so the globals stay within the file that installs them.

function install(options) {
  const o = options || {};
  const settings = { delay: o.delay === undefined ? 1 : o.delay, configDelay: o.configDelay || 0 };
  const counts = { decoders: 0, configured: 0, closedDecoders: 0, frames: 0, liveFrames: 0 };
  const bitmaps = [];

  class VideoFrame {
    constructor(timestamp, w, h) {
      this.timestamp = timestamp;
      this.displayWidth = this.codedWidth = w;
      this.displayHeight = this.codedHeight = h;
      this.format = null;                      // an opaque frame: the store's bake takes the canvas route
      this.closed = false;
      counts.frames++;
      counts.liveFrames++;
    }
    close() { if (!this.closed) { this.closed = true; counts.liveFrames--; } }
  }

  class EncodedVideoChunk {
    constructor(init) { Object.assign(this, init); }
  }

  class VideoDecoder extends EventTarget {
    constructor(init) {
      super();
      this.output = init.output;
      this.state = 'unconfigured';
      this.decodeQueueSize = 0;
      this.gen = 0;                            // bumped by reset() and close(): outputs of an older generation are dropped
      this.w = 0;
      this.h = 0;
      counts.decoders++;
    }

    static isConfigSupported(config) {
      return new Promise((resolve) => setTimeout(() => resolve({ supported: true, config }), settings.configDelay));
    }

    configure(config) {
      if (this.state === 'closed') throw new Error('configure on a closed decoder');
      this.state = 'configured';
      this.w = config.codedWidth;
      this.h = config.codedHeight;
      counts.configured++;
    }

    decode(chunk) {
      if (this.state !== 'configured') throw new Error('decode in state ' + this.state);
      this.decodeQueueSize++;
      const gen = this.gen;
      setTimeout(() => {
        if (gen !== this.gen || this.state !== 'configured') return;
        this.decodeQueueSize--;
        this.dispatchEvent(new Event('dequeue'));
        this.output(new VideoFrame(chunk.timestamp, this.w, this.h));
      }, settings.delay);
    }

    flush() {
      const gen = this.gen;
      return new Promise((resolve, reject) => setTimeout(() => (gen === this.gen ? resolve() : reject(new Error('aborted'))), settings.delay + 2));
    }

    reset() { this.gen++; this.decodeQueueSize = 0; this.state = 'unconfigured'; }

    close() {
      if (this.state === 'closed') return;
      this.gen++;
      this.decodeQueueSize = 0;
      this.state = 'closed';
      counts.closedDecoders++;
    }
  }

  function bitmap(width, height, source) {
    const b = { width, height, source, closed: false, close() { this.closed = true; } };
    bitmaps.push(b);
    return b;
  }

  // createImageBitmap(source, options?) or (source, sx, sy, sw, sh, options?): the size asked for (resizeWidth /
  // resizeHeight, the crop), else the source's own; a Blob source is taken to be o.blobSize (default 100 × 100).
  async function createImageBitmap(source, a, b, c, d, e) {
    const crop = typeof a === 'number';
    const opts = (crop ? e : a) || {};
    const size = source && (source.displayWidth || source.width)
      ? [source.displayWidth || source.width, source.displayHeight || source.height] : (o.blobSize || [100, 100]);
    const w = opts.resizeWidth || (crop ? c : size[0]), h = opts.resizeHeight || (crop ? d : size[1]);
    return bitmap(w, h, source);
  }

  const canvas = {
    made: [],
    draws: [],
    create(w, h) {
      const cv = {
        width: w, height: h,
        transferToImageBitmap() { return bitmap(w, h, cv); },
        convertToBlob: async (opts) => new Blob([new Uint8Array(8)], { type: (opts && opts.type) || 'image/png' }),
      };
      const ctx = {
        canvas: cv, filter: 'none', globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000',
        drawImage(image, ...args) { canvas.draws.push({ canvas: cv, image, args, filter: ctx.filter }); },
        getImageData(x, y, gw, gh) { return { data: new Uint8ClampedArray(gw * gh * 4).fill(255), width: gw, height: gh }; },
      };
      for (const name of ['save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'clearRect', 'fillRect', 'putImageData']) {
        ctx[name] = () => {};
      }
      canvas.made.push(cv);
      return { canvas: cv, ctx };
    },
  };

  globalThis.VideoFrame = VideoFrame;
  globalThis.EncodedVideoChunk = EncodedVideoChunk;
  globalThis.VideoDecoder = VideoDecoder;
  globalThis.createImageBitmap = createImageBitmap;
  return { settings, counts, canvas, bitmaps, VideoFrame };
}

module.exports = { install };
