/* 文字PVメーカー v2 — original work. Export math (frames, timestamps, audio length, sizes, codecs), formats, the Filmora kit's files and pre-flight (§4.21; DESIGN_2_1 §13). */
MV.def('export/schedule', ['core/script', 'core/doc', 'audio/wav', 'media/samples', 'engine/scene/frame'], (script, D, WAV, SM, F) => {
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
  // Transparent WebM: the alpha stream's bitrate as a share of the colour stream's. §13.5 said 25 %; measured, VP9 then
  // leaves ghost trails behind moving text by the end of a key-frame interval (α up to 98/255 where the frame is clear,
  // NOTES ## v2.1-H.2). At the colour's bitrate the encoder (variable rate) takes what the alpha needs: on project_basic
  // about 0.8 of the colour stream's bytes.
  const ALPHA_SHARE = 1;
  const WAV_RATE = 48000;                           // the kit's song file: PCM 16-bit stereo at the decode rate
  const KIT_README = 'README_Filmora.txt';
  const KIT_SUFFIX = '_filmora';                    // the kit's folder (and ZIP) name: '<base>_filmora'
  const KIT_SHORTS = Object.freeze([1080, 2160]);   // the sizes Filmora handles best (kit-size otherwise)
  const README_BYTES = 4096;                        // estimate of README_Filmora.txt
  const SRT_CUE_BYTES = 40;                         // an SRT cue besides its text: number, times, line breaks
  const LRC_TAG_BYTES = 10;                         // '[mm:ss.xx]'
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

  // The export down-mix lives in audio/wav (the kit's WAV uses it too, and audio/* may not depend on export/*).
  const mixMatrix = WAV.mixMatrix;
  const fillPlanar = WAV.fillPlanar;

  // --- formats (DESIGN_2_1 §13.3) ----------------------------------------------------------------------------------

  // FORMATS: what each output.format writes, in the order of core/doc OUTPUT_CHOICES.format.
  //   ext    the file's extension (the kit: its ZIP, when the browser cannot write a folder)
  //   mime   its media type
  //   alpha  transparent frames (the backdrop is always `clear`, backdropFor)
  //   video  encoded with WebCodecs (pre-flight: no-webcodecs)
  //   codec  'avc' (H.264, pickAvc), 'vp9' (VP9 alpha, pickVp9), 'avc+vp9' (the kit: H.264, plus VP9 for its overlay), null
  //   audio  the sound it carries: 'aac-opus' (AAC, else Opus in MP4), 'opus' (WebM), 'aac-wav' (AAC, else a WAV file)
  //   folder the set of files goes into a folder (or one ZIP)
  const FORMATS = Object.freeze({
    mp4: Object.freeze({ ext: 'mp4', mime: 'video/mp4', alpha: false, video: true, codec: 'avc', audio: 'aac-opus', folder: false }),
    kit: Object.freeze({ ext: 'zip', mime: 'application/zip', alpha: false, video: true, codec: 'avc+vp9', audio: 'aac-wav',
      folder: true }),
    webmAlpha: Object.freeze({ ext: 'webm', mime: 'video/webm', alpha: true, video: true, codec: 'vp9', audio: 'opus', folder: false }),
    png: Object.freeze({ ext: 'zip', mime: 'application/zip', alpha: false, video: false, codec: null, audio: null, folder: false }),
    pngAlpha: Object.freeze({ ext: 'zip', mime: 'application/zip', alpha: true, video: false, codec: null, audio: null, folder: false }),
  });

  function formatOf(format) { return FORMATS[format] || FORMATS.mp4; }

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

  // alphaBitrate(bits) → the transparent WebM's alpha stream bitrate: ALPHA_SHARE of the colour stream's (§13.5).
  function alphaBitrate(bits) { return Math.round(bits * ALPHA_SHARE); }

  // estimateWebmBytes(duration, bits, audio) → a transparent WebM: the colour and the alpha streams, Opus when `audio`.
  function estimateWebmBytes(duration, bits, audio) {
    const total = bits + alphaBitrate(bits) + (audio ? OPUS_BITRATE : 0);
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

  // pickVp9(w, h, fps) → codec strings to try in order: VP9 profile 0, 8-bit, at the smallest level whose picture size
  // and sample rate hold the stream (the VP9 level table of media/samples), then VP8 (both carry alpha in WebM).
  function pickVp9(w, h, fps) {
    return ['vp09.00.' + String(SM.vp9Level(w, h, fps)).padStart(2, '0') + '.08', 'vp8'];
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

  // backdropFor(format, backdrop) → the backdrop to render: the transparent formats (透過WebM, 透過PNG) always clear;
  // every other format (MP4, the kit's main video, PNG連番) renders the document's backdrop, `clear` read as `scene`.
  function backdropFor(format, backdrop) {
    if (formatOf(format).alpha) return 'clear';
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

  // --- the Filmora kit (DESIGN_2_1 §13.9) ------------------------------------------------------------------------

  // kitOptions(output) → the kit's optional files: output.kit, or the defaults for a document that has none.
  function kitOptions(output) {
    const k = output && output.kit;
    const out = {};
    for (const key of D.KIT_KEYS) out[key] = k && typeof k[key] === 'boolean' ? k[key] : D.KIT_DEFAULT[key];
    return out;
  }

  // kitBase(doc) → the name every file of the kit starts with: fileName(doc, …) without its extension.
  function kitBase(doc) { return fileName(doc, 'mp4').slice(0, -'.mp4'.length); }

  // kitFolder(doc) → '<base>_filmora': the folder the kit writes into, and its ZIP's name without '.zip'.
  function kitFolder(doc) { return kitBase(doc) + KIT_SUFFIX; }

  function utf8Length(text) {
    let n = 0;
    for (const ch of String(text)) {
      const cp = ch.codePointAt(0);
      n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    }
    return n;
  }

  // Whether the kit's main MP4 carries the song (AAC), from probe().audioCodec: AAC encodes, or not probed yet.
  function kitAac(env) { return env.audioCodec === undefined || env.audioCodec === 'mp4a.40.2'; }

  // kitFiles(doc, plan, env) → [{ name, kind, est }] in the order of §13.9: every file the kit writes, with its estimated
  // size in bytes. kind ∈ main overlay bg green srt lrc wav readme. The main MP4 and the README are always written; the
  // others follow output.kit; the WAV holds the song when the MP4 cannot (no AAC encoder, env.audioCodec is not
  // 'mp4a.40.2') and output.audio is on with a song that is loaded (env.songReady is not false). The WAV's size is exact
  // (audioFrames(N) frames at 48 kHz); the videos follow the bitrates (the green screen always at quality max, §13.6).
  function kitFiles(doc, plan, env) {
    const e = env || {};
    const out = doc.output;
    const kit = kitOptions(out);
    const base = kitBase(doc);
    const { t0, t1 } = exportRange(doc, plan);
    const dur = Math.max(0, t1 - t0);
    const N = frameCount(dur, out.fps);
    const { w, h } = outputSize(plan.design.aspect, out.short);
    const bits = bitrate(w, h, out.fps, out.quality);
    const song = !!(out.audio && doc.song) && e.songReady !== false;
    const aac = song && kitAac(e);
    const files = [{ name: base + '.mp4', kind: 'main', est: estimateBytes(dur, bits, aac) }];
    if (kit.overlay) files.push({ name: base + '_overlay.webm', kind: 'overlay', est: estimateWebmBytes(dur, bits, false) });
    if (kit.bg) files.push({ name: base + '_bg.mp4', kind: 'bg', est: estimateBytes(dur, bits, false) });
    if (kit.green) files.push({ name: base + '_green.mp4', kind: 'green', est: estimateBytes(dur, bitrate(w, h, out.fps, 'max'), false) });
    const lines = (plan.lines || []).filter((l) => l.t0 < t1 && l.t1 > t0);
    if (kit.srt) {
      let est = 3;                                                     // the BOM
      lines.forEach((l, k) => { est += SRT_CUE_BYTES + String(k + 1).length + utf8Length(l.text); });
      files.push({ name: base + '.srt', kind: 'srt', est });
    }
    if (kit.lrc) {
      let est = 0;
      for (const l of plan.lines || []) est += LRC_TAG_BYTES + utf8Length(l.text) + 1;
      files.push({ name: base + '.lrc', kind: 'lrc', est });
    }
    if (song && !aac) files.push({ name: base + '.wav', kind: 'wav', est: WAV.HEADER_BYTES + audioFrames(N, out.fps, WAV_RATE) * 4 });
    files.push({ name: KIT_README, kind: 'readme', est: README_BYTES });
    return files;
  }

  // layerDiffs(doc, plan, registry?) → { keys, seams }: where the kit's background under its overlay differs from the
  // full render (§13.7), over the export range. keys: the screen effects the full render runs that the layers leave out
  // or apply to one layer only — every accent filter of a cut on screen in the range (the background keeps the work
  // texture only) and the texture when it is not alphaSafe (the overlay leaves it out) — sorted; seams: the world seams
  // (each output mixes its own worlds). Without a registry every accent counts (they all run under `scene`).
  function layerDiffs(doc, plan, registry) {
    const { t0, t1 } = exportRange(doc, plan);
    const backdrop = backdropFor('kit', doc.look.backdrop);
    const runs = (key) => {
      if (!registry || typeof registry.get !== 'function') return true;
      return F.filterAllowed(registry.get('filter', key), backdrop);
    };
    const keys = new Set();
    for (const cut of plan.cuts || []) {
      if (!(cut.a < t1 && cut.b > t0) || !cut.slots) continue;
      const count = cut.slots['filter.count'] ? cut.slots['filter.count'].v || 0 : 0;
      for (let k = 0; k < count; k++) {
        const d = cut.slots['filter#' + k];
        if (d && typeof d.v === 'string' && d.v !== 'none' && runs(d.v)) keys.add(d.v);
      }
    }
    const tex = plan.look && plan.look.texture;
    if (tex && typeof tex.v === 'string' && tex.v !== 'none' && runs(tex.v) && registry && typeof registry.get === 'function'
        && !F.filterAllowed(registry.get('filter', tex.v), 'clear')) keys.add(tex.v);
    let seams = 0;
    for (const seam of plan.seams || []) {
      if (seam.scope === 'world' && seam.dur > 0 && seam.at - seam.dur / 2 < t1 && seam.at + seam.dur / 2 > t0) seams++;
    }
    return { keys: [...keys].sort(), seams };
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

  // The size an export builds in memory (no File System Access), by format; the kit: the sum of its files.
  function memoryBytes(doc, plan, env, range, size, withAudio) {
    const out = doc.output;
    const dur = Math.max(0, range.t1 - range.t0);
    const bits = () => bitrate(size.w, size.h, out.fps, out.quality);
    if (out.format === 'kit') return kitFiles(doc, plan, env).reduce((sum, f) => sum + f.est, 0);
    if (out.format === 'mp4') return estimateBytes(dur, bits(), withAudio);
    if (out.format === 'webmAlpha') return estimateWebmBytes(dur, bits(), withAudio);
    return estimatePngBytes(frameCount(dur, out.fps), size.w, size.h, out.format === 'pngAlpha');
  }

  // preflight(doc, plan, env) → [{ code, level: 'block'|'confirm'|'warn'|'info', params, jump?, fix? }] (§4.21;
  // DESIGN_2_1 §13.10). env = {
  //   webcodecs, codec (first supported AVC string, null = none, undefined = not checked), audioCodec (the MP4 audio codec,
  //   probe().audioCodec: 'mp4a.40.2' | 'opus' | null = none | undefined = not checked), anyCodec (false: no H.264
  //   encoder at any size; undefined: not checked), vp9Codec (probe().vp9Codec: the first VP9 or VP8 string that encodes,
  //   null = none, undefined = not checked), fontsReady, fsAccess (a file can be written: showSaveFilePicker),
  //   dirAccess (a folder can be written, for the kit: showDirectoryPicker; default fsAccess), songReady (decoded audio
  //   available), registry (the effective registry, for layers-approx), warnings (engine.warnings(); default plan.warnings) }
  // A browser without any H.264 encoder (a Chromium build without proprietary codecs) gets `no-h264` rather than
  // `no-codec`: a smaller size or frame rate would not help there. The formats (FORMATS):
  //   mp4        H.264; AAC, else Opus in MP4 with the note opus-audio, else no sound (no-audio-codec)
  //   webmAlpha  VP9 or VP8 (no-vp9 blocks); Opus
  //   kit        H.264 for its MP4s, VP9 for its overlay (no-vp9 blocks while the overlay is on); AAC, else the WAV file
  //              (kit-wav); kit-fps, kit-size, layers-approx (background and overlay both on), kit-memory for the set
  //   png, pngAlpha  no encoder
  function preflight(doc, plan, env) {
    const e = env || {};
    const out = doc.output;
    const items = [];
    const format = out.format;
    const kind = formatOf(format);
    const mp4 = format === 'mp4', kit = format === 'kit', webm = format === 'webmAlpha';
    const avc = mp4 || kit;
    const kitOpts = kit ? kitOptions(out) : null;
    const vp9 = webm || (kit && kitOpts.overlay);
    const range = exportRange(doc, plan);
    const { t0, t1 } = range;
    const size = outputSize(plan.design.aspect, out.short);
    const { w, h } = size;
    const withAudio = kind.video && out.audio && !!doc.song;
    if (!(t1 > t0)) items.push({ code: 'range-empty', level: 'block', params: {} });
    if (kind.video && !e.webcodecs) items.push({ code: 'no-webcodecs', level: 'block', params: {} });
    else {
      if (avc && e.codec === null && e.anyCodec === false) items.push({ code: 'no-h264', level: 'block', params: {} });
      else if (avc && e.codec === null) items.push({ code: 'no-codec', level: 'block', params: { w, h, fps: out.fps } });
      if (vp9 && e.vp9Codec === null) items.push({ code: 'no-vp9', level: 'block', params: {} });
    }
    // DESIGN_2_1 §13.4. MP4: AAC, else Opus in MP4 with a note (some editors cannot read it), else no sound. WebM: Opus
    // (no sound only when no audio codec encodes at all). The kit: AAC, else the song as a WAV file next to the MP4.
    if (withAudio && e.webcodecs && e.songReady !== false) {
      if ((mp4 || webm) && e.audioCodec === null) items.push({ code: 'no-audio-codec', level: 'warn', params: {} });
      else if (mp4 && e.audioCodec === 'opus') items.push({ code: 'opus-audio', level: 'info', params: {} });
      else if (kit && !kitAac(e)) items.push({ code: 'kit-wav', level: 'info', params: { name: kitBase(doc) } });
    }
    if (withAudio && e.songReady === false) items.push({ code: 'song-missing', level: 'warn', params: { name: doc.song.name } });
    if (mp4 && doc.look.backdrop === 'clear') items.push({ code: 'clear-mp4', level: 'warn', params: {} });
    if (e.fontsReady === false) items.push({ code: 'fonts-loading', level: 'info', params: {} });
    const inMemory = kit ? !(e.dirAccess === undefined ? e.fsAccess : e.dirAccess) : !e.fsAccess;
    if (inMemory) {
      const bytes = memoryBytes(doc, plan, e, range, size, withAudio);
      items.push({ code: kit ? 'kit-memory' : 'memory', level: bytes > MEMORY_CONFIRM_BYTES ? 'confirm' : 'warn', params: { bytes } });
    }
    if (kit) {
      items.push({ code: 'kit-fps', level: 'info', params: { fps: out.fps, w, h } });
      if (!KIT_SHORTS.includes(out.short)) items.push({ code: 'kit-size', level: 'info', params: { short: out.short } });
      if (kitOpts.overlay && kitOpts.bg) {
        const diffs = layerDiffs(doc, plan, e.registry);
        if (diffs.keys.length || diffs.seams) items.push({ code: 'layers-approx', level: 'info', params: diffs });
      }
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
    ALPHA_SHARE, WAV_RATE, KIT_README, KIT_SHORTS, FORMATS,
    frameCount, ts, frameDur, audioFrames, keyInterval, audioChunkCount, audioChunk, fillPlanar, mixMatrix,
    outputSize, bitrate, alphaBitrate, estimateBytes, estimateWebmBytes, estimatePngBytes, eta, pickAvc, pickVp9,
    exportRange, backdropFor, renderScale, fileName, frameName, kitOptions, kitBase, kitFolder, kitFiles, layerDiffs,
    flashEvents, flashRate, preflight,
  };
});
