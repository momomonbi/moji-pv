/* 文字PVメーカー v2 — original work. Export math (frames, timestamps, audio length, sizes, codecs) and pre-flight (§4.21). */
MV.def('export/schedule', ['core/script'], (script) => {
  'use strict';

  class ExportError extends Error {
    constructor(code, message, detail) {
      super(message || code);
      this.name = 'ExportError';
      this.code = code;
      if (detail !== undefined) this.detail = detail;
    }
  }

  const QUALITY_BPP = Object.freeze({ standard: 0.08, high: 0.12, max: 0.18 });   // bits per pixel per frame
  const AUDIO_BITRATE = 192000;                     // AAC-LC
  const OPUS_BITRATE = 160000;                      // Opus in MP4, where the browser has no AAC encoder (DESIGN_2_1 §13.4)
  const AUDIO_CHUNK = 1024;                         // frames per AudioData
  const MUX_OVERHEAD = 1.02;                        // container bytes on top of the streams
  const MEMORY_CONFIRM_BYTES = 1.5 * 1024 ** 3;     // an in-memory export above this asks for confirmation
  const PNG_BYTES_PER_PIXEL = { rgb: 1.2, rgba: 1.6 };   // rough PNG size of rendered frames, for the memory warning
  const FLASH_PARTS = Object.freeze({ seam: Object.freeze(['whiteFlash']), filter: Object.freeze(['flashPop', 'invertBlink']) });
  // How the flash screen effects fire (parts/filter/flash.js, NOTES ## WP5b2 review fixes), so the count is what renders:
  //   gap    'beat' events are every stride-th beat of the grid, stride = ⌈gap / period⌉ (none without a grid);
  //   span   how long the flashes of one event last ('depart' fires at cut-local max(0, dur − span));
  //   count  flashes per event (invertBlink: `blinks` ≤ 3, on a beat only those over by the next beat), each 2/rate apart.
  const FLASH_FILTERS = Object.freeze({
    flashPop: Object.freeze({ gap: 1 / 3, span: (p) => 2 * num(p.decay, 0.2), count: () => 1, step: () => 0 }),
    invertBlink: Object.freeze({
      gap: 1,
      span: (p) => (2 * blinksOf(p)) / num(p.rate, 12),
      count: (p, period) => (period > 0 ? Math.max(1, Math.min(blinksOf(p), Math.floor((period * num(p.rate, 12) + 1) / 2 + 1e-9)))
        : blinksOf(p)),
      step: (p) => 2 / num(p.rate, 12),
    }),
  });
  const FLASH_SAFE_AMP = 0.3;                       // flashes at or below this strength are not counted (the fix pins 0.3)
  const FLASH_LIMIT = 3;                            // more than this many flashes in any 1 s window is a warning
  const FLASH_FIX = Object.freeze({ t: 'pin.set', path: 'work:amount.flash', v: 0.3, by: 'user' });
  const FLASH_MERGE = 1 / 60;                       // events closer than this are one flash

  // H.264 levels: [level_idc hex, max frame size in macroblocks, max macroblocks per second].
  const AVC_LEVELS = Object.freeze([
    ['28', 8192, 245760], ['2A', 8704, 522240], ['32', 22080, 589824], ['33', 36864, 983040],
    ['34', 36864, 2073600], ['3C', 139264, 4177920], ['3D', 139264, 8355840], ['3E', 139264, 16711680],
  ]);
  const AVC_PROFILES = Object.freeze(['6400', '4D00', '42E0']);   // High, Main, constrained Baseline

  // --- frame math (FROZEN, §4.21) --------------------------------------------------------------------------------

  // Never negative (and never −0) for empty or negative spans.
  function frameCount(duration, fps) { return Math.max(0, Math.ceil(duration * fps - 1e-9)); }

  function ts(i, fps) { return Math.round((i * 1e6) / fps); }

  function frameDur(i, fps) { return ts(i + 1, fps) - ts(i, fps); }

  function audioFrames(N, fps, rate) { return Math.round((N * rate) / fps); }

  function keyInterval(fps) { return 2 * fps; }

  // --- audio chunks ------------------------------------------------------------------------------------------------

  function audioChunkCount(total, size = AUDIO_CHUNK) { return Math.ceil(total / size); }

  // audioChunk(k, rate, total, size) → { from, frames, timestamp µs } of the k-th AudioData of an export.
  function audioChunk(k, rate, total, size = AUDIO_CHUNK) {
    const from = k * size;
    return { from, frames: Math.max(0, Math.min(size, total - from)), timestamp: Math.round((from * 1e6) / rate) };
  }

  const HALF = 0.5;
  const ROOT_HALF = Math.SQRT1_2;

  // mixMatrix(inCount, outCount) → for each output channel, its [source channel, gain] terms. Stereo output follows the
  // Web Audio 'speakers' down-mix, which is what the player plays: mono goes to both sides; quad (L R SL SR) folds each
  // surround into its side at ½; 5.1 (L R C LFE SL SR) adds √½ of the centre and of each surround and drops the LFE.
  // Other layouts, and other output counts, are 'discrete': channel c from channel c, a mono source copied everywhere.
  function mixMatrix(inCount, outCount) {
    if (outCount === 2 && inCount === 4) return [[[0, HALF], [2, HALF]], [[1, HALF], [3, HALF]]];
    if (outCount === 2 && inCount === 6) {
      return [[[0, 1], [2, ROOT_HALF], [4, ROOT_HALF]], [[1, 1], [2, ROOT_HALF], [5, ROOT_HALF]]];
    }
    const out = [];
    for (let c = 0; c < outCount; c++) out.push(inCount === 1 ? [[0, 1]] : c < inCount ? [[c, 1]] : []);
    return out;
  }

  // fillPlanar(out, channels, start, frames, outChannels = 2): planar f32 samples [start, start + frames) of the source,
  // zero outside it, mixed down (or copied) to outChannels by mixMatrix.
  function fillPlanar(out, channels, start, frames, outChannels = 2) {
    const matrix = mixMatrix(channels.length, outChannels);
    for (let c = 0; c < outChannels; c++) {
      const base = c * frames;
      out.fill(0, base, base + frames);
      for (const [from, gain] of matrix[c]) {
        const src = channels[from];
        const a = Math.max(0, -start), b = Math.min(frames, src.length - start);
        for (let i = a; i < b; i++) out[base + i] += gain * src[start + i];
      }
    }
    return out;
  }

  // --- sizes, bitrate, estimates, codecs ----------------------------------------------------------------------------

  function even(x) { return 2 * Math.round(x / 2); }

  // outputSize(aspect 'a:b', short) → { w, h }: the short side is `short`, the long side is rounded to an even number.
  function outputSize(aspect, short) {
    const m = /^(\d+):(\d+)$/.exec(String(aspect));
    if (!m) throw new ExportError('aspect', 'unknown aspect ' + aspect);
    const a = Number(m[1]), b = Number(m[2]);
    if (a >= b) return { w: even((short * a) / b), h: short };
    return { w: short, h: even((short * b) / a) };
  }

  function bitrate(w, h, fps, quality) {
    const bpp = QUALITY_BPP[quality];
    if (bpp === undefined) throw new ExportError('quality', 'unknown quality ' + quality);
    return Math.round(w * h * fps * bpp);
  }

  function estimateBytes(duration, bits, audio) {
    const total = bits + (audio ? AUDIO_BITRATE : 0);
    return Math.ceil(((duration * total) / 8) * MUX_OVERHEAD);
  }

  function estimatePngBytes(frames, w, h, alpha) {
    return Math.ceil(frames * w * h * (alpha ? PNG_BYTES_PER_PIXEL.rgba : PNG_BYTES_PER_PIXEL.rgb));
  }

  // eta(samples [{ i, ms }] in frame order, remaining frames) → seconds, from an EMA (α = 0.1) of the per-frame time.
  function eta(samples, remaining) {
    if (!samples || samples.length === 0) return null;
    let ema = samples[0].ms;
    for (let k = 1; k < samples.length; k++) ema += 0.1 * (samples[k].ms - ema);
    return (ema * Math.max(0, remaining)) / 1000;
  }

  // pickAvc(w, h, fps) → codec strings to try in order: High, Main and Baseline at the smallest level that fits.
  function pickAvc(w, h, fps) {
    const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);
    const level = AVC_LEVELS.find(([, fs, rate]) => mbs <= fs && mbs * fps <= rate) || AVC_LEVELS[AVC_LEVELS.length - 1];
    return AVC_PROFILES.map((p) => 'avc1.' + p + level[0]);
  }

  // --- what to render -----------------------------------------------------------------------------------------------

  // exportRange(doc, plan) → { t0, t1 }: output.range clamped to the video, or the whole video.
  function exportRange(doc, plan) {
    const d = plan.duration;
    const r = doc.output.range;
    if (!r) return { t0: 0, t1: d };
    const t0 = Math.min(Math.max(0, r.t0), d);
    return { t0, t1: Math.min(Math.max(t0, r.t1), d) };
  }

  // backdropFor(format, backdrop) → the backdrop to render: transparent PNGs always clear; `clear` exists only for PNG.
  function backdropFor(format, backdrop) {
    if (format === 'pngAlpha') return 'clear';
    return backdrop === 'clear' ? 'scene' : backdrop;
  }

  function renderScale(design, w, h) { return Math.min(w / design.w, h / design.h); }

  const BAD_NAME = /[\\/:*?"<>|\u0000-\u001f\u007f]+/g;

  const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
  const NAME_UNITS = 80;           // UTF-16 units: at most 240 UTF-8 bytes, so '<name>_00000.png' fits any file system

  // The longest prefix of s that ends on a grapheme boundary and has at most `units` UTF-16 units, so an emoji
  // (a surrogate pair, a ZWJ family, a flag) is never cut in half.
  function clip(s, units) {
    if (s.length <= units) return s;
    const offs = script.graphemeOffsets(s);
    let end = 0;
    for (let k = 0; k < offs.length && offs[k] <= units; k++) end = offs[k];
    return s.slice(0, end);
  }

  function cleanName(s) {
    const text = String(s).replace(LONE_SURROGATE, '').replace(BAD_NAME, ' ').replace(/\s+/g, ' ').trim();
    return clip(text, NAME_UNITS).trim();
  }

  function titleOf(doc) {
    for (const row of doc.sheet.rows) {
      const m = /^\s*\[ti:(.*)\]\s*$/i.exec(row.src);
      if (m && m[1].trim()) return m[1];
    }
    return '';
  }

  // fileName(doc, ext) → output.name, else the [ti:] title, else 'mojipv'; unsafe characters removed; `.ext` added once.
  function fileName(doc, ext) {
    const suffix = '.' + ext;
    let base = cleanName(doc.output.name || '');
    if (base.toLowerCase().endsWith(suffix)) base = base.slice(0, -suffix.length).trim();
    if (!base) base = cleanName(titleOf(doc));
    if (!base) base = 'mojipv';
    return base + suffix;
  }

  // frameName(base, i, N) → 'base_00042.png' (at least 5 digits, enough for N − 1).
  function frameName(base, i, N) {
    const digits = Math.max(5, String(Math.max(0, N - 1)).length);
    return base + '_' + String(i).padStart(digits, '0') + '.png';
  }

  // --- pre-flight -------------------------------------------------------------------------------------------------

  function beatTimes(beats, a, b) {
    const out = [];
    if (!beats || !(beats.bpm > 0)) return out;
    const period = 60 / beats.bpm;
    for (let k = Math.ceil((a - beats.offset) / period - 1e-9); beats.offset + k * period < b; k++) {
      out.push(beats.offset + k * period);
    }
    return out;
  }

  function num(v, dflt) { return typeof v === 'number' && Number.isFinite(v) ? v : dflt; }
  function blinksOf(p) { return Math.max(1, Math.min(3, num(p.blinks, 2) | 0)); }

  // The flashes the flash screen effects of one cut draw. A cut's screen effects run while it is the current cut,
  // [t0, next cut's t0) (engine/scene/frame currentCut), so only flashes inside that span count. Flashes at or below
  // the safe amount are not counted (invertBlink does not blink at all there).
  function filterFlashes(cut, until, beats, times) {
    for (const key of Object.keys(cut.slots).sort()) {
      if (!/^filter#\d$/.test(key)) continue;
      const d = cut.slots[key];
      const kind = d ? FLASH_FILTERS[d.v] : null;
      if (!kind) continue;
      const p = d.p || {};
      if (typeof p.amount === 'number' && p.amount <= FLASH_SAFE_AMP) continue;
      const when = p.when || 'impact';
      const period = beats && beats.bpm > 0 ? 60 / beats.bpm : 0;
      const events = [];
      if (when === 'beat') {
        if (period > 0) {
          const stride = Math.max(1, Math.ceil(kind.gap / period - 1e-9));
          for (const t of beatTimes(beats, cut.t0, until)) {
            const index = Math.round((t - beats.offset) / period);
            if (((index % stride) + stride) % stride === 0) events.push(t);
          }
        }
      } else if (when === 'arrive') events.push(cut.t0);
      else if (when === 'depart') {
        const dur = cut.feat && typeof cut.feat.dur === 'number' ? cut.feat.dur : cut.t1 - cut.t0;
        events.push(cut.t0 + Math.max(0, dur - kind.span(p)));
      } else if (cut.impact) events.push(cut.t0);
      const n = kind.count(p, when === 'beat' ? period : 0), step = kind.step(p);
      for (const e of events) {
        for (let j = 0; j < n; j++) {
          const t = e + j * step;
          if (t >= cut.t0 && t < until) times.push(t);
        }
      }
    }
  }

  // flashEvents(plan) → sorted times of full-frame flashes: strong `flash` impulses, flash seams and flash filters.
  function flashEvents(plan) {
    const times = [];
    const cuts = plan.cuts || [];
    for (const imp of plan.impulses || []) if (imp.kind === 'flash' && imp.amp > FLASH_SAFE_AMP) times.push(imp.t);
    for (const seam of plan.seams || []) if (seam.slot && FLASH_PARTS.seam.includes(seam.slot.v)) times.push(seam.at);
    cuts.forEach((cut, i) => {
      if (cut.slots) filterFlashes(cut, i + 1 < cuts.length ? Math.max(cut.t0, cuts[i + 1].t0) : cut.b, plan.beats, times);
    });
    times.sort((x, y) => x - y);
    const merged = [];
    for (const t of times) if (!merged.length || t - merged[merged.length - 1] >= FLASH_MERGE) merged.push(t);
    return merged;
  }

  // flashRate(plan) → { count, at }: the most flashes inside any 1 s window and where that window starts.
  function flashRate(plan) {
    const times = flashEvents(plan);
    let count = 0, at = null;
    for (let i = 0, j = 0; i < times.length; i++) {
      while (j < times.length && times[j] - times[i] < 1) j++;
      if (j - i > count) { count = j - i; at = times[i]; }
    }
    return { count, at };
  }

  function lineNumber(plan, lineId) {
    const i = (plan.lines || []).findIndex((l) => l.id === lineId);
    return i < 0 ? null : i + 1;
  }

  function warningItems(plan, warnings, items) {
    const seenLines = new Set(), seenFaces = new Set();
    for (const w of warnings) {
      if (w.code === 'overfull') {
        const key = w.line || w.cut || '';
        if (seenLines.has(key)) continue;
        seenLines.add(key);
        items.push({ code: 'overfull', level: 'warn', params: { line: lineNumber(plan, w.line) }, jump: { cut: w.cut || null } });
      } else if (w.code === 'font-fallback') {
        const family = (w.detail && w.detail.family) || null;
        if (seenFaces.has(family)) continue;
        seenFaces.add(family);
        items.push({ code: 'font-fallback', level: 'info', params: { family } });
      }
    }
  }

  // preflight(doc, plan, env) → [{ code, level: 'block'|'confirm'|'warn'|'info', params, jump?, fix? }] (§4.21).
  // env = { webcodecs, codec (first supported AVC string, null = none, undefined = not checked), audioCodec (the MP4 audio
  //         codec, probe().audioCodec: 'mp4a.40.2' | 'opus' | null = none | undefined = not checked),
  //         anyCodec (false: no H.264 encoder at any size; undefined: not checked), fontsReady, fsAccess,
  //         songReady (decoded audio available), warnings (engine.warnings(); default plan.warnings) }
  // A browser without any H.264 encoder (a Chromium build without proprietary codecs) gets `no-h264` rather than
  // `no-codec`: a smaller size or frame rate would not help there.
  function preflight(doc, plan, env) {
    const e = env || {};
    const out = doc.output;
    const items = [];
    const mp4 = out.format === 'mp4';
    const { t0, t1 } = exportRange(doc, plan);
    const { w, h } = outputSize(plan.design.aspect, out.short);
    const withAudio = mp4 && out.audio && !!doc.song;
    if (!(t1 > t0)) items.push({ code: 'range-empty', level: 'block', params: {} });
    if (mp4 && !e.webcodecs) items.push({ code: 'no-webcodecs', level: 'block', params: {} });
    else if (mp4 && e.codec === null && e.anyCodec === false) items.push({ code: 'no-h264', level: 'block', params: {} });
    else if (mp4 && e.codec === null) items.push({ code: 'no-codec', level: 'block', params: { w, h, fps: out.fps } });
    // AAC, else Opus in MP4 with a note (some editors cannot read it), else no sound (DESIGN_2_1 §13.4)
    if (withAudio && e.webcodecs && e.audioCodec === null) items.push({ code: 'no-audio-codec', level: 'warn', params: {} });
    else if (withAudio && e.webcodecs && e.audioCodec === 'opus') items.push({ code: 'opus-audio', level: 'info', params: {} });
    if (withAudio && e.songReady === false) items.push({ code: 'song-missing', level: 'warn', params: { name: doc.song.name } });
    if (mp4 && doc.look.backdrop === 'clear') items.push({ code: 'clear-mp4', level: 'warn', params: {} });
    if (e.fontsReady === false) items.push({ code: 'fonts-loading', level: 'info', params: {} });
    if (!e.fsAccess) {
      const frames = frameCount(Math.max(0, t1 - t0), out.fps);
      const bytes = mp4 ? estimateBytes(t1 - t0, bitrate(w, h, out.fps, out.quality), withAudio)
        : estimatePngBytes(frames, w, h, out.format === 'pngAlpha');
      items.push({ code: 'memory', level: bytes > MEMORY_CONFIRM_BYTES ? 'confirm' : 'warn', params: { bytes } });
    }
    const flash = flashRate(plan);
    if (flash.count > FLASH_LIMIT) {
      items.push({ code: 'flash-rate', level: 'warn', params: { n: flash.count, at: flash.at }, jump: { t: flash.at },
        fix: Object.assign({}, FLASH_FIX) });
    }
    warningItems(plan, e.warnings || plan.warnings || [], items);
    return items;
  }

  return {
    ExportError, QUALITY_BPP, AUDIO_BITRATE, OPUS_BITRATE, AUDIO_CHUNK, MEMORY_CONFIRM_BYTES, FLASH_PARTS, FLASH_LIMIT, FLASH_SAFE_AMP,
    frameCount, ts, frameDur, audioFrames, keyInterval, audioChunkCount, audioChunk, fillPlanar, mixMatrix,
    outputSize, bitrate, estimateBytes, estimatePngBytes, eta, pickAvc,
    exportRange, backdropFor, renderScale, fileName, frameName, flashEvents, flashRate, preflight,
  };
});
