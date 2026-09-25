/* 文字PVメーカー v2 — original work. Baked blur of video and animation frames: a small blurred copy made once per source frame, off the draw call (DESIGN_2_1 §11.4.6). */
MV.def('media/host/bake', ['media/yuv'], (YUV) => {
  'use strict';

  // createBaker({ canvas, now }) → Baker (one per store fork; its jobs run one at a time)
  //   variant(long, px, blur) → Variant | null     long: the frame's displayed long side; px, blur: the draw's want
  //       (device px). null when blur is 0. Variant = { b, sigma, blur, key }: the copy is 1/b of the frame
  //       (media/yuv.factorFor), blurred by sigma copy px (blur × copy px per device px, in 1/32 px); key = b|sigma,
  //       and the copy is a function of (source frame, key) only.
  //   bake(held, v, { alpha }) → Promise<Baked>    held = the session's Held { image, index, w, h, rot }
  //       Baked = { bitmap: ImageBitmap, w, h (the copy's displayed size: the frame's / b), index, blur, bytes, route }
  //       Route 'yuv': a VideoFrame whose format is 8-bit I420 / NV12 with a known matrix (media/yuv.supports) and b ≥
  //       2 — copyTo (the visible rect), the box average and colour conversion of media/yuv with a mirrored border of 3σ,
  //       putImageData, then ctx.filter blur into a copy-sized canvas. That includes a GPU-backed frame that reports
  //       such a format: copyTo reads it back (nothing here tells how a frame is backed; the readback's cost on a GPU
  //       machine is not measured). Route 'canvas' (any other frame: a format of null, as an opaque GPU frame can
  //       have, a 10-bit or alpha format, an unknown matrix, the alpha-merged or animation ImageBitmap, or b = 1): the
  //       browser draws the frame into a copy-sized canvas, the border is 8 mirrored draws of it (or transparent for a
  //       medium with alpha), then the same blur. The route depends on the frame's own properties only, never on
  //       history.
  //       Without ctx.filter, a smaller copy scaled back up stands in for the blur (as engine/render/post does).
  //   stats() → { prepMs, baked, yuv, canvas }   dispose()

  function createBaker(opts) {
    const o = opts || {};
    const factory = o.canvas || null;
    const now = typeof o.now === 'function' ? o.now : () => 0;
    const canvases = new Map();              // 'role wxh' → { canvas, ctx } (a few sizes per store)
    let bytes = null, rgba = null;           // scratch: the planes of a frame, the copy with its border
    let chain = Promise.resolve();
    let filterOk = null;
    const counters = { prepMs: 0, baked: 0, yuv: 0, canvas: 0 };

    function surface(role, w, h) {
      const key = role + ' ' + w + 'x' + h;
      let s = canvases.get(key);
      if (s) { canvases.delete(key); canvases.set(key, s); return s; }
      s = factory ? factory.create(w, h, { alpha: true }) : (() => { const c = new OffscreenCanvas(w, h); return { canvas: c, ctx: c.getContext('2d') }; })();
      canvases.set(key, s);
      while (canvases.size > 8) canvases.delete(canvases.keys().next().value);
      return s;
    }

    function filterWorks(ctx) {
      if (filterOk === null) {
        try { ctx.filter = 'blur(1px)'; filterOk = ctx.filter === 'blur(1px)'; ctx.filter = 'none'; } catch (e) { filterOk = false; }
      }
      return filterOk;
    }

    function variant(long, px, blur) {
      if (!(blur > 0) || !(long > 0)) return null;
      const need = px > 0 ? px : long;
      const b = YUV.factorFor(long, need, blur);
      const sigma = YUV.sigmaFor(blur, long, b, need);
      return { b, sigma, blur: Math.max(1, Math.round(blur * 8)) / 8, key: b + '|' + sigma };
    }

    function isFrame(img) { return typeof VideoFrame !== 'undefined' && img instanceof VideoFrame; }

    // The blurred copy: src (a canvas cw + 2·pad by ch + 2·pad holding the copy and its border) → an ImageBitmap cw × ch.
    function blurInto(src, cw, ch, pad, sigma) {
      const out = surface('out', cw, ch);
      const g = out.ctx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, cw, ch);
      if (filterWorks(g)) {
        g.filter = 'blur(' + Math.round(sigma * 1000) / 1000 + 'px)';
        g.drawImage(src.canvas, -pad, -pad);
        g.filter = 'none';
      } else {
        const d = Math.max(1, Math.ceil(sigma));             // no ctx.filter: a smaller copy scaled back up
        const sw = Math.max(1, Math.ceil(cw / d)), sh = Math.max(1, Math.ceil(ch / d));
        const small = surface('small', sw, sh);
        small.ctx.clearRect(0, 0, sw, sh);
        small.ctx.drawImage(src.canvas, pad, pad, cw, ch, 0, 0, sw, sh);
        g.drawImage(small.canvas, 0, 0, sw, sh, 0, 0, cw, ch);
      }
      return out.canvas.transferToImageBitmap ? out.canvas.transferToImageBitmap() : createImageBitmap(out.canvas);
    }

    async function viaYuv(img, v) {
      const rect = img.visibleRect;
      const vw = rect.width, vh = rect.height;
      const size = img.allocationSize();
      if (!bytes || bytes.length < size) bytes = new Uint8Array(size);
      const layout = await img.copyTo(bytes);
      const cw = Math.ceil(vw / v.b), ch = Math.ceil(vh / v.b);
      const pad = YUV.padFor(v.sigma, cw, ch);
      const need = (cw + 2 * pad) * (ch + 2 * pad) * 4;
      if (!rgba || rgba.length < need) rgba = new Uint8ClampedArray(need);
      const cs = img.colorSpace || {};
      const r = YUV.toRgba({ format: img.format, data: bytes, layout, w: vw, h: vh },
        { b: v.b, matrix: cs.matrix, full: cs.fullRange === true, pad, out: rgba });
      const a = surface('in', r.w, r.h);
      a.ctx.putImageData(new ImageData(r.data, r.w, r.h), 0, 0);
      const bitmap = await blurInto(a, cw, ch, pad, v.sigma);
      return { bitmap, cw, ch, vw, vh };
    }

    async function viaCanvas(img, v, alpha) {
      const iw = isFrame(img) ? img.displayWidth : img.width, ih = isFrame(img) ? img.displayHeight : img.height;
      const cw = Math.max(1, Math.ceil(iw / v.b)), ch = Math.max(1, Math.ceil(ih / v.b));
      const pad = YUV.padFor(v.sigma, cw, ch);
      const t = surface('copy', cw, ch);
      t.ctx.setTransform(1, 0, 0, 1, 0, 0);
      t.ctx.globalCompositeOperation = 'copy';
      t.ctx.drawImage(img, 0, 0, cw, ch);
      t.ctx.globalCompositeOperation = 'source-over';
      const a = surface('in', cw + 2 * pad, ch + 2 * pad);
      const g = a.ctx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cw + 2 * pad, ch + 2 * pad);
      if (alpha || pad === 0) g.drawImage(t.canvas, pad, pad);
      else {
        // the copy and its 8 mirrored neighbours: pixel −1 − k of the border shows pixel k, as media/yuv mirrors
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) {
            const sx = i ? -1 : 1, sy = j ? -1 : 1;
            const tx = i < 0 ? pad : i > 0 ? pad + 2 * cw : pad, ty = j < 0 ? pad : j > 0 ? pad + 2 * ch : pad;
            g.setTransform(sx, 0, 0, sy, tx, ty);
            g.drawImage(t.canvas, 0, 0);
          }
        }
        g.setTransform(1, 0, 0, 1, 0, 0);
      }
      const bitmap = await blurInto(a, cw, ch, pad, v.sigma);
      return { bitmap, cw, ch, vw: iw, vh: ih };
    }

    function bake(held, v, bo) {
      const alpha = !!(bo && bo.alpha);
      const job = chain.then(async () => {
        const t0 = now();
        const img = held.image;
        const yuv = v.b >= 2 && !alpha && isFrame(img) && typeof img.copyTo === 'function' && YUV.supports(img.format, img.colorSpace);
        const made = yuv ? await viaYuv(img, v) : await viaCanvas(img, v, alpha);
        counters.prepMs += now() - t0;
        counters.baked++;
        counters[yuv ? 'yuv' : 'canvas']++;
        const turned = held.rot === 90 || held.rot === 270;
        const w = (turned ? made.vh : made.vw) / v.b, h = (turned ? made.vw : made.vh) / v.b;
        return { bitmap: made.bitmap, w, h, index: held.index, blur: v.blur, bytes: made.cw * made.ch * 4, route: yuv ? 'yuv' : 'canvas' };
      });
      chain = job.then(() => {}, () => {});
      return job;
    }

    return {
      variant, bake,
      stats() { return Object.assign({}, counters); },
      dispose() { canvases.clear(); bytes = null; rgba = null; },
    };
  }

  return { createBaker };
});
