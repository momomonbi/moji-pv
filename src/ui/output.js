/* 文字PVメーカー v2 — original work. Output rules shared by step ④, the stage and the inspector: format ↔ backdrop, filters per backdrop, UI pre-flight items, the summary line and the Filmora set's contents (DESIGN §3.2, §4.19.4, §4.21, §6.4.3; DESIGN_2_1 §13.3, §13.10). */
MV.def('ui/output', ['export/schedule', 'engine/scene/frame'], (S, F) => {
  'use strict';

  // The formats in the order of core/doc OUTPUT_CHOICES.format. Step ④'s 形式 shows MAIN_FORMATS as a segmented pair
  // and OTHER_FORMATS in its その他 ▾ select (DESIGN_2_1 §13.10).
  const FORMATS = Object.freeze(['mp4', 'kit', 'webmAlpha', 'png', 'pngAlpha']);
  const MAIN_FORMATS = Object.freeze(['mp4', 'kit']);
  const OTHER_FORMATS = Object.freeze(['webmAlpha', 'png', 'pngAlpha']);
  const BACKDROPS = Object.freeze(['scene', 'chroma', 'black', 'clear']);
  // The Filmora set's optional files, in the order of its contents list (core/doc KIT_KEYS); the main MP4 is always in.
  const KIT_KEYS = Object.freeze(['overlay', 'bg', 'green', 'srt', 'lrc']);
  // The name of every file the set can hold, by export/schedule.kitFiles kind.
  const KIT_LABELS = Object.freeze({ main: 'exp.kit.main', overlay: 'exp.kit.overlay', bg: 'exp.kit.bg', green: 'exp.kit.green',
    srt: 'exp.kit.srt', lrc: 'exp.kit.lrc', wav: 'exp.kit.wav', readme: 'exp.kit.readme' });

  // Whether a format writes transparent frames (透過動画（WebM）, 透過PNG; export/schedule FORMATS).
  function isAlpha(format) { return !!(S.FORMATS[format] && S.FORMATS[format].alpha); }

  // A transparent format and the backdrop 透明 go together (DESIGN_2_1 §13.3), so the pair is kept consistent. Each
  // helper returns the commands of one user choice (the caller dispatches them as one undo entry).

  // formatCmds(doc, format) → commands: 透過動画 or 透過PNG makes the backdrop 透明; MP4, Filmora用 or PNG連番 turn 透明
  // back to 通常 (the Filmora set renders the document's backdrop and is never transparent as a whole).
  function formatCmds(doc, format) {
    const cmds = [];
    if (doc.output.format !== format) cmds.push({ t: 'output.set', key: 'format', v: format });
    const backdrop = doc.look.backdrop;
    if (isAlpha(format) && backdrop !== 'clear') cmds.push({ t: 'look.set', key: 'backdrop', v: 'clear' });
    if (!isAlpha(format) && backdrop === 'clear') cmds.push({ t: 'look.set', key: 'backdrop', v: 'scene' });
    return cmds;
  }

  // Fewer pixels and frames reduce rendering work. Keep an already smaller / slower choice, and retain sound,
  // range, compression quality and the Filmora set. A user choice is one undo entry at the caller.
  function speedProfile(doc) {
    return { short: Math.min(doc.output.short, doc.output.format === 'kit' ? 1080 : 720),
      fps: Math.min(doc.output.fps, 30) };
  }

  function speedCmds(doc) {
    const profile = speedProfile(doc);
    return Object.keys(profile).filter((key) => profile[key] !== doc.output[key])
      .map((key) => ({ t: 'output.set', key, v: profile[key] }));
  }

  // transparentOf(format) → the format the backdrop 透明 leads to: 透過PNG from a PNG sequence (frames stay frames, as the
  // way back gives PNG連番 again), else 透過動画（WebM）, the primary transparent path (from MP4 and Filmora用).
  function transparentOf(format) { return format === 'png' || format === 'pngAlpha' ? 'pngAlpha' : 'webmAlpha'; }

  // opaqueOf(format) → the format another backdrop leads to from a transparent one: 透過動画 → MP4, 透過PNG → PNG連番.
  function opaqueOf(format) { return format === 'pngAlpha' ? 'png' : format === 'webmAlpha' ? 'mp4' : format; }

  // backdropCmds(doc, backdrop) → commands: 透明 makes the output transparent (transparentOf); another backdrop while the
  // output is transparent makes it opaque (opaqueOf), so the file shows the chosen background.
  function backdropCmds(doc, backdrop) {
    const cmds = [];
    if (doc.look.backdrop !== backdrop) cmds.push({ t: 'look.set', key: 'backdrop', v: backdrop });
    const format = doc.output.format;
    if (backdrop === 'clear' && !isAlpha(format)) cmds.push({ t: 'output.set', key: 'format', v: transparentOf(format) });
    if (backdrop !== 'clear' && isAlpha(format)) cmds.push({ t: 'output.set', key: 'format', v: opaqueOf(format) });
    return cmds;
  }

  // clearLabel(format) → the key that names the backdrop 透明 in step ④'s list: what choosing it makes of this format.
  function clearLabel(format) { return transparentOf(format) === 'pngAlpha' ? 'exp.bg.clearPng' : 'exp.bg.clearWebm'; }

  // backdropChoices(format, backdrop) → the backdrops step ④'s 背景 list offers. Filmora用 leaves 透明 out: choosing it
  // would turn the set into 透過動画 and another backdrop then into MP4, so exploring the list lost the set (the set has
  // its own transparent file, 「文字と装飾だけ」 in 詳しく). A document that is already 透明 keeps it listed.
  function backdropChoices(format, backdrop) {
    return format === 'kit' && backdrop !== 'clear' ? BACKDROPS.filter((b) => b !== 'clear') : BACKDROPS.slice();
  }

  // backdropNote(doc) → the note under 背景: the green screen's how-to line (DESIGN_2_1 §13.6) when the file is green,
  // else the transparency advice (exp.alphaNote2, §13.10) — not for Filmora用, whose set has its own transparent video.
  function backdropNote(doc) {
    if (effectiveBackdrop(doc) === 'chroma') return 'exp.chromaNote';
    return doc.output.format === 'kit' ? null : 'exp.alphaNote2';
  }

  // The backdrop the export renders (export/schedule.backdropFor); the preview renders the same one.
  function effectiveBackdrop(doc) { return S.backdropFor(doc.output.format, doc.look.backdrop); }

  // Whether the document's format and backdrop agree (a file saved before the pair was coupled may not).
  function consistent(doc) { return isAlpha(doc.output.format) === (doc.look.backdrop === 'clear'); }

  // skipOf(registry, key, backdrop) → null when the filter runs under the backdrop, else that backdrop (§4.19.4).
  function skipOf(registry, key, backdrop) {
    if (!key || key === 'none' || !registry || !registry.has('filter', key)) return null;
    return F.filterAllowed(registry.get('filter', key), backdrop) ? null : backdrop;
  }

  // usedFilters(plan, cutKeys?) → sorted keys of the screen effects the plan uses: the work texture and every
  // `filter#i` below the cut's count (only the given cuts when cutKeys is passed; the texture only for the whole plan).
  function usedFilters(plan, cutKeys) {
    const keys = new Set();
    if (!plan) return [];
    const only = cutKeys ? new Set(cutKeys) : null;
    if (!only && plan.look && plan.look.texture && plan.look.texture.v && plan.look.texture.v !== 'none') keys.add(plan.look.texture.v);
    for (const cut of plan.cuts || []) {
      if (only && !only.has(cut.key)) continue;
      const slots = cut.slots || {};
      const n = slots['filter.count'] ? slots['filter.count'].v || 0 : 0;
      for (let i = 0; i < n; i++) {
        const d = slots['filter#' + i];
        if (d && typeof d.v === 'string' && d.v !== 'none') keys.add(d.v);
      }
    }
    return [...keys].sort();
  }

  // skippedFilters(plan, registry, backdrop, cutKeys?) → the used filters the backdrop leaves out.
  function skippedFilters(plan, registry, backdrop, cutKeys) {
    return usedFilters(plan, cutKeys).filter((key) => skipOf(registry, key, backdrop) !== null);
  }

  // checks(doc, plan, registry) → the UI's own pre-flight items (export/schedule.preflight has the rest):
  //   fx-skipped (info)      the effective backdrop leaves out screen effects the video uses (params.keys)
  //   alpha-backdrop (warn)  透過動画 or 透過PNG with a backdrop other than 透明: the export clears it anyway
  //                          (params.format; fix: backdrop 透明)
  //   clear-png (warn)       PNG連番 with 透明: the frames get the normal background              (fix: format 透過PNG)
  // A fix is a list of commands, dispatched as one undo entry.
  function checks(doc, plan, registry) {
    const out = [];
    const format = doc.output.format;
    const backdrop = doc.look.backdrop;
    if (isAlpha(format) && backdrop !== 'clear') {
      out.push({ code: 'alpha-backdrop', level: 'warn', params: { bg: backdrop, format }, fix: backdropCmds(doc, 'clear') });
    }
    if (format === 'png' && backdrop === 'clear') out.push({ code: 'clear-png', level: 'warn', params: {}, fix: formatCmds(doc, 'pngAlpha') });
    const effective = effectiveBackdrop(doc);
    if (effective !== 'scene' && plan) {
      const keys = skippedFilters(plan, registry, effective);
      if (keys.length) out.push({ code: 'fx-skipped', level: 'info', params: { bg: effective, keys } });
    }
    return out;
  }

  // kitCmd(doc, key, on) → the command that puts one optional file into the Filmora set or leaves it out (output.set kit
  // takes the whole object, DESIGN_2_1 §13.3).
  function kitCmd(doc, key, on) {
    return { t: 'output.set', key: 'kit', v: Object.assign(S.kitOptions(doc.output), { [key]: !!on }) };
  }

  // The items whose text names the chosen format (params.format: 「このブラウザでは{format}を書き出せません」).
  const NAMES_FORMAT = new Set(['no-webcodecs', 'no-h264', 'no-audio-codec']);

  // withFixes(items, doc) → pre-flight items where the schedule's `clear-mp4` gets its fix (switch to 透過動画); a video
  // this browser cannot encode at all (`no-webcodecs`, `no-h264`) offers frames instead — 透過PNG for 透過動画 (it stays
  // transparent), PNG連番 for MP4 — and nothing for the Filmora set (a PNG sequence is no way into Filmora, R3: the text
  // alone sends the user to Chrome or Edge); a transparent video it cannot encode (`no-vp9`) offers 透過PNG — in the
  // Filmora set, leaving the transparent video out (params.kit). The items that name the format get params.format.
  // Every `fix` is a command list.
  function withFixes(items, doc) {
    const format = doc.output.format;
    return items.map((c) => {
      if (NAMES_FORMAT.has(c.code)) c = Object.assign({}, c, { params: Object.assign({}, c.params, { format }) });
      if (c.code === 'clear-mp4' && !c.fix) return Object.assign({}, c, { fix: formatCmds(doc, 'webmAlpha') });
      if ((c.code === 'no-webcodecs' || c.code === 'no-h264') && !c.fix) {
        if (format === 'kit') return c;
        return Object.assign({}, c, { fix: formatCmds(doc, isAlpha(format) ? 'pngAlpha' : 'png') });
      }
      if (c.code === 'no-vp9' && !c.fix) {
        const kit = doc.output.format === 'kit';
        return Object.assign({}, c, { params: Object.assign({}, c.params, { kit }),
          fix: kit ? [kitCmd(doc, 'overlay', false)] : formatCmds(doc, 'pngAlpha') });
      }
      if (c.fix && !Array.isArray(c.fix)) return Object.assign({}, c, { fix: [c.fix] });
      return c;
    });
  }

  // The button of a pre-flight item that has a fix, by code.
  const FIX_LABELS = Object.freeze({ 'flash-rate': 'exp.pre.flash-fix', 'clear-mp4': 'exp.pre.makeWebm', 'clear-png': 'exp.pre.makeAlpha',
    'alpha-backdrop': 'exp.pre.makeClear', 'no-webcodecs': 'exp.pre.makePng', 'no-h264': 'exp.pre.makePng' });

  // fixLabel(item) → the string key of an item's fix button; no-vp9, no-webcodecs and no-h264 name what their fix does
  // (withFixes: 透過動画 → 透過PNG).
  function fixLabel(item) {
    const p = item.params || {};
    if (item.code === 'no-vp9') return p.kit ? 'exp.pre.noOverlay' : 'exp.pre.makeAlpha';
    if ((item.code === 'no-webcodecs' || item.code === 'no-h264') && isAlpha(p.format)) return 'exp.pre.makeAlpha';
    return FIX_LABELS[item.code] || 'exp.pre.fix';
  }

  // checkKey(item) → the string key of a pre-flight item's text: 'exp.pre.<code>', and for the Filmora set without an
  // H.264 encoder its own text (the MP4s of the set cannot be made here; no PNG sequence is offered).
  function checkKey(item) {
    if (item.code === 'no-h264' && item.params && item.params.format === 'kit') return 'exp.pre.kit-no-h264';
    if (item.code === 'song-missing' && item.level === 'block') return item.params && item.params.audioSource === 'local'
      ? 'exp.pre.audio-local-song-missing' : 'exp.pre.audio-server-song-missing';
    return 'exp.pre.' + item.code;
  }

  // layersWhat(params, t) → the {what} of `layers-approx` (DESIGN_2_1 §13.7): the screen effects by name, then the scene
  // changes that each file mixes on its own, as one list — 「A・B・C」 in Japanese, "A, B, and C" in English.
  function layersWhat(params, t) {
    const p = params || {};
    const names = (p.keys || []).map((k) => t.part('filter', k));
    if (p.seams) names.push(t('exp.pre.layers.seams', { n: p.seams }));
    return listText(names, t);
  }

  // listText(names, t) → the names as one list in t's language: 「・」 in Japanese, a sentence list in English.
  function listText(names, t) {
    if (t.lang === 'en' && names.length > 1 && typeof Intl !== 'undefined' && typeof Intl.ListFormat === 'function') {
      return new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(names);
    }
    return names.join(t('list.sep'));
  }

  // summary(doc, plan, env) → step ④'s one line under its settings as { key, params }, bytes and seconds as numbers (the
  // caller formats them). env = { fsAccess, dirAccess, audioCodec, songReady } (the probe and the sink's abilities).
  //   Filmora用  exp.kit.summary { n: files, bytes: Σ kitFiles estimates, where: 'folder' | 'zip' } (§13.10)
  //   others     exp.summary { w, h, fps, seconds, bytes, where: 'disk' | 'memory' }
  function summary(doc, plan, env) {
    const e = S.audioEnv(doc, env);
    const o = doc.output;
    if (o.format === 'kit') {
      const files = S.kitFiles(doc, plan, e);
      return { key: 'exp.kit.summary', params: { n: files.length, bytes: files.reduce((sum, f) => sum + f.est, 0),
        where: e.dirAccess ? 'folder' : 'zip' } };
    }
    const { t0, t1 } = S.exportRange(doc, plan);
    const seconds = Math.max(0, t1 - t0);
    const { w, h } = S.outputSize(plan.design.aspect, o.short);
    const codec = o.format === 'webmAlpha' ? e.webmAudioCodec : e.audioCodec;
    const song = !!(o.audio && doc.song) && e.songReady !== false && codec !== null;
    let bytes;
    if (o.format === 'mp4') bytes = S.estimateBytes(seconds, S.bitrate(w, h, o.fps, o.quality), song, e.audioBitrate);
    else if (o.format === 'webmAlpha') bytes = S.estimateWebmBytes(seconds, S.bitrate(w, h, o.fps, o.quality), song, e.webmAudioBitrate);
    else bytes = S.estimatePngBytes(S.frameCount(seconds, o.fps), w, h, o.format === 'pngAlpha');
    return { key: 'exp.summary', params: { w, h, fps: o.fps, seconds, bytes, where: e.fsAccess ? 'disk' : 'memory' } };
  }

  // All estimates use the same range, size, fps and sound as the selected output. PNG is lossless and has
  // no bitrate-based quality levels; kit estimates include its auxiliary files, not just the main video.
  function qualityOptions(doc, plan, env) {
    const rows = S.QUALITY_LEVELS.map((quality) => {
      const sample = Object.assign({}, doc, { output: Object.assign({}, doc.output, { quality }) });
      const total = summary(sample, plan, env);
      return { quality, bytes: total.params.bytes };
    });
    const base = rows.find((row) => row.quality === 'standard').bytes;
    for (const row of rows) row.ratio = base > 0 ? row.bytes / base : 1;
    return { lossless: doc.output.format === 'png' || doc.output.format === 'pngAlpha', rows };
  }

  // The probed encoder setting (a target bitrate, not a measurement of the finished file). Unknown support shows
  // the preferred rate until the probe completes; format-specific probes keep MP4 AAC and WebM Opus separate.
  function audioInfo(doc, env) {
    const e = S.audioEnv(doc, env), o = doc.output;
    if (!hasSound(o.format)) return { state: 'image' };
    if (!o.audio) return { state: 'off' };
    if (!doc.song) return { state: 'no-song' };
    if (e.songReady === false) return { state: 'missing' };
    const webm = o.format === 'webmAlpha';
    const codec = webm ? e.webmAudioCodec : e.audioCodec;
    const bitrate = webm ? e.webmAudioBitrate : e.audioBitrate;
    if (o.format === 'kit' && codec !== undefined && codec !== 'mp4a.40.2') return { state: 'wav' };
    if (codec === null) return { state: 'unavailable' };
    if (codec === undefined || !(bitrate > 0)) return { state: 'checking', preferred: S.AUDIO_BITRATE };
    const mode = webm ? e.webmAudioBitrateMode : e.audioBitrateMode;
    return { state: 'ready', codec, bitrate, mode: mode || null, preferred: S.AUDIO_BITRATE, fallback: bitrate < S.AUDIO_BITRATE,
      ...(e.audioSource ? { source: e.audioSource } : {}) };
  }

  // kitLabel(kind) → the key that names a file of the set (step ④'s done list, the guide), or null (none for a kind
  // this module does not know).
  function kitLabel(kind) { return KIT_LABELS[kind] || null; }

  // kitAlways(doc, plan, env) → the kinds of the files the set adds by itself, in its order (export/schedule.kitFiles):
  // the song's WAV where the browser cannot put the song into the MP4, and the README. 詳しく lists them under the
  // checkboxes, so its rows add up to the summary line's count. env = { audioCodec, songReady } as for kitFiles.
  function kitAlways(doc, plan, env) {
    return S.kitFiles(doc, plan, S.audioEnv(doc, env)).map((f) => f.kind)
      .filter((kind) => kind === 'wav' || kind === 'readme');
  }

  // shownChecks(items) → the pre-flight items step ④ lists: a memory note only when it asks first (the summary line
  // already says 「メモリ上で作成」 or 「ZIPでダウンロード」).
  function shownChecks(items) {
    return items.filter((c) => !((c.code === 'memory' || c.code === 'kit-memory') && c.level !== 'confirm'));
  }

  // hasSound(format) → whether the format can carry the song (音声を入れる applies): MP4, the set, 透過動画.
  function hasSound(format) { return !!(S.FORMATS[format] && S.FORMATS[format].audio); }

  // mergeFonts(items) → the items with every `font-fallback` folded into the first one (params.families), so a
  // blocked font service gives one line instead of one per typeface.
  function mergeFonts(items) {
    const fonts = items.filter((c) => c.code === 'font-fallback');
    if (fonts.length < 2) return items.map((c) => (c.code === 'font-fallback' ? withFamilies(c, [c.params.family]) : c));
    const families = [...new Set(fonts.map((c) => c.params && c.params.family).filter(Boolean))];
    const out = [];
    let placed = false;
    for (const c of items) {
      if (c.code !== 'font-fallback') out.push(c);
      else if (!placed) { out.push(withFamilies(c, families)); placed = true; }
    }
    return out;
  }

  function withFamilies(c, families) {
    return Object.assign({}, c, { params: Object.assign({}, c.params, { families: families.filter(Boolean) }) });
  }

  // errorKey(code) → the string key that explains an export failure (export/schedule ExportError codes).
  const ERROR_KEYS = Object.freeze({
    cancelled: 'err.exp.cancelled', sink: 'err.exp.sink', 'range-empty': 'exp.pre.range-empty',
    'no-webcodecs': 'exp.pre.no-webcodecs', 'no-codec': 'err.exp.codec', codec: 'err.exp.codec', 'no-plan': 'err.exp.noPlan',
    media: 'err.exp.media', 'no-vp9': 'exp.pre.no-vp9',
    'audio-server-config': 'err.exp.audioServerConfig', 'audio-server-auth': 'err.exp.audioServerAuth',
    'audio-server-network': 'err.exp.audioServerNetwork', 'audio-server-too-large': 'err.exp.audioServerTooLarge',
    'audio-server-response': 'err.exp.audioServerResponse', 'audio-server-media': 'err.exp.audioServerMedia',
    'audio-server-busy': 'err.exp.audioServerBusy', 'audio-server-timeout': 'err.exp.audioServerTimeout',
    'audio-server-convert': 'err.exp.audioServerConvert',
    'audio-local-unavailable': 'err.exp.audioLocalUnavailable', 'audio-local-load': 'err.exp.audioLocalLoad',
    'audio-local-memory': 'err.exp.audioLocalMemory', 'audio-local-too-large': 'err.exp.audioLocalTooLarge',
    'audio-local-convert': 'err.exp.audioLocalConvert', 'audio-local-response': 'err.exp.audioLocalResponse',
    'audio-local-busy': 'err.exp.audioLocalBusy', 'audio-local-media': 'err.exp.audioLocalMedia',
  });
  function errorKey(code) { return ERROR_KEYS[code] || 'err.exp.encode'; }

  // errorParams(err) → the params of that message: for a photo or video the export could not read
  // (ExportError('media'), detail { id, name, code }, DESIGN_2_1 §11.4.4), the asset's name ('—' when the library no
  // longer names it).
  function errorParams(err) {
    if (!err || err.code !== 'media') return {};
    const name = err.detail && typeof err.detail.name === 'string' ? err.detail.name.trim() : '';
    return { name: name || '—' };
  }

  const PROCESS_STAGES = new Set(['prepare', 'video', 'audioLoading', 'audioPrepare', 'audio', 'finalize', 'mux', 'files', 'zip', 'save']);
  const ACCELERATION_HINTS = new Set(['prefer-hardware', 'prefer-software', 'no-preference']);
  function advanceProcess(state, event) {
    const st = state || {}, p = event || {};
    const next = Object.assign({}, st, { process: Object.assign({}, st.process, p) });
    if (PROCESS_STAGES.has(p.stage) && (!st.process || p.stage !== st.process.stage)) {
      // Legacy progress can count downloaded converter bytes, not video frames. A newly installed video encoder
      // starts its own frame count and ETA; real stage transitions also retire the previous progress phase.
      next.part = null;
      if (p.stage === 'video') {
        next.i = 0;
        next.N = Number.isSafeInteger(p.frameCount) && p.frameCount > 0 ? p.frameCount : 0;
        next.eta = null;
      }
    }
    return next;
  }
  function codecName(codec) {
    if (typeof codec !== 'string' || !codec) return '';
    if (codec.startsWith('avc1')) return 'H.264';
    if (codec.startsWith('vp09') || codec === 'vp9') return 'VP9';
    if (codec === 'vp8') return 'VP8';
    if (codec === 'mp4a.40.2') return 'AAC';
    if (codec === 'opus') return 'Opus';
    return codec === 'png' ? 'PNG' : codec === 'pcm-s16le' ? 'PCM' : codec;
  }

  // Running-export copy uses only this export's snapshot and the host's actual installed-output events. In
  // particular, a successful support probe is not evidence that an encoder is using the GPU. Legacy callers that
  // emit only frame progress still get useful stage text, without inventing installed codec / acceleration data.
  function processInfo(state) {
    const st = state || {}, p = st.process || {};
    const format = st.format || p.format || 'mp4';
    const legacy = st.progressPhase || st.part || st.phase;
    const stage = PROCESS_STAGES.has(p.stage) ? p.stage : legacy === 'audioLocalLoading' ? 'audioLoading'
      : legacy === 'audioLocal' || legacy === 'audioServer' ? 'audio' : legacy === 'files' || legacy === 'zip' ? legacy
        : st.N > 0 ? 'video' : 'prepare';
    const png = format === 'png' || format === 'pngAlpha';
    const outputs = Array.isArray(p.outputs) ? p.outputs.filter((o) => o && typeof o === 'object') : [];
    const infos = outputs.length ? outputs.map((o) => o.acceleration).filter(Boolean) : p.acceleration ? [p.acceleration] : [];
    const hints = infos.flatMap((a) => [a.selected, a.alphaSelected].filter((h) => ACCELERATION_HINTS.has(h)));
    const gpu = png ? 'not-video' : !hints.length ? 'pending' : new Set(hints).size > 1 ? 'mixed'
      : hints[0] === 'prefer-hardware' ? 'hardware' : hints[0] === 'prefer-software' ? 'software'
        : infos.some((a) => a.fallback) ? 'fallback' : 'browser';
    const codecs = [...new Set((outputs.length ? outputs.map((o) => o.codec) : [p.codec]).map(codecName).filter(Boolean))];
    const source = p.audioSource === null ? 'none' : p.audioSource || (legacy === 'audioLocal' || legacy === 'audioLocalLoading' ? 'local'
      : legacy === 'audioServer' ? 'server' : 'pending');
    const routeSource = st.audioRoute || source;
    const intermediateAudio = p.temporary && (routeSource === 'local' || routeSource === 'server');
    // A ready original song without native AAC becomes the Filmora set's separate WAV. The host's explicit null
    // codec confirms that fallback during the video pass, before its files stage creates the WAV itself.
    const nativeWavFallback = format === 'kit' && routeSource === 'browser' && p.audioSource === null && p.audioCodec === null;
    const noNativeAudio = source === 'browser' && Object.prototype.hasOwnProperty.call(p, 'audioCodec') && !p.audioCodec;
    const audio = png ? 'none' : intermediateAudio ? routeSource : nativeWavFallback ? 'wav'
      : source === 'none' || noNativeAudio ? 'none' : source;
    const detail = stage === 'video' && png ? 'images' : stage === 'video' && format === 'webmAlpha' ? 'transparent'
      : stage === 'audio' && source === 'local' ? 'audioLocal' : stage === 'audio' && source === 'server' ? 'audioServer'
        : stage === 'finalize' && p.backend === 'ffmpeg' ? 'validate' : stage === 'mux' && p.temporary ? 'muxTemporary' : stage;
    const route = png ? 'png' : format === 'webmAlpha' ? audio === 'none' ? 'webmSilent' : 'webm' : format === 'kit' ? 'kit'
      : routeSource === 'local' ? 'local' : routeSource === 'server' ? 'server' : audio === 'none' ? 'silent' : 'mp4';
    return { stage, format, gpu, audio, codec: codecs.join(' / '), audioCodec: codecName(p.audioCodec),
      stageKey: 'exp.process.stage.' + stage, detailKey: 'exp.process.detail.' + detail,
      routeKey: 'exp.process.route.' + route, gpuKey: 'exp.process.gpu.' + gpu,
      audioKey: 'exp.process.audio.' + (['local', 'server', 'browser', 'wav', 'none'].includes(audio) ? audio : 'pending'),
      // 100% of submitted frames is not a completed file: encoder drain, audio conversion, container finalization
      // and saving have their own indeterminate stages. Never reuse a stale video percentage in those stages.
      indeterminate: stage !== 'video' || !(st.N > 0),
      outputs: outputs.map((o) => ({ kind: o.kind, codec: codecName(o.codec), acceleration: o.acceleration })) };
  }

  return {
    FORMATS, MAIN_FORMATS, OTHER_FORMATS, BACKDROPS, KIT_KEYS, ERROR_KEYS, isAlpha, formatCmds, transparentOf, opaqueOf,
    backdropCmds, clearLabel, backdropChoices, backdropNote, effectiveBackdrop, consistent, skipOf, usedFilters, skippedFilters,
    checks, kitCmd, withFixes, fixLabel, checkKey, layersWhat, listText, summary, qualityOptions, audioInfo,
    usesAudioServer: S.usesAudioServer, usesLocalAudio: S.usesLocalAudio, usesDedicatedAudio: S.usesDedicatedAudio, audioEnv: S.audioEnv,
    kitLabel, kitAlways, shownChecks, hasSound, speedProfile, speedCmds,
    mergeFonts, errorKey, errorParams, processInfo, advanceProcess,
  };
});
