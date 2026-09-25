/* 文字PVメーカー v2 — original work. The Filmora kit: one pass over the timeline writes the main MP4, the transparent overlay, the background and green-screen MP4s, the song WAV, SRT, LRC and a README into a folder or one ZIP (DESIGN_2_1 §13.9). */
MV.def('export/host/kit', ['export/schedule', 'export/subtitles', 'export/zip', 'export/host/mp4', 'export/host/webm',
  'export/host/sink', 'audio/wav', 'core/commands', 'i18n/t', 'i18n/strings'], (S, SUB, Z, J, WH, SINK, WAV, C, T, STRINGS) => {
  'use strict';

  const KEY_COLOUR = '#00B140';         // the green screen's key colour (D§4.19.4 `chroma`)
  const WAV_BLOCK = 1 << 20;            // frames of the WAV converted and written per step (4 MB)
  const CRC_SLICE = 8 * 1024 * 1024;    // bytes of a memory file read per step for the ZIP's CRC-32
  const CRLF = '\r\n';
  const RULE = '-'.repeat(60);
  // The label of each file in the README (the step ④ strings of §13.10); the README does not list itself.
  const LABELS = Object.freeze({ main: 'exp.kit.main', overlay: 'exp.kit.overlay', bg: 'exp.kit.bg', green: 'exp.kit.green',
    srt: 'exp.kit.srt', lrc: 'exp.kit.lrc', wav: 'exp.kit.wav' });
  const TYPES = Object.freeze({ main: 'video/mp4', overlay: 'video/webm', bg: 'video/mp4', green: 'video/mp4', srt: 'text/plain',
    lrc: 'text/plain', wav: 'audio/wav', readme: 'text/plain' });

  // --- the README (pure) ---------------------------------------------------------------------------------------------

  function nameOf(files, kind) { const f = files.find((x) => x.kind === kind); return f ? f.name : null; }

  // steps(t, files, { w, h, fps }) → the numbered steps everyone follows (texts, in t's language): the project settings,
  // the main MP4 at 0:00 and — when the song is a WAV file because the MP4 has no sound — the WAV right after it, each
  // with its real name. The README and the in-app guide (ui/filmora_help) both use it.
  function steps(t, files, info) {
    const out = [t('kit.help.1', { w: info.w, h: info.h, fps: info.fps }), t('kit.help.2', { main: nameOf(files, 'main') })];
    if (nameOf(files, 'wav')) out.push(t('kit.help.6', { wav: nameOf(files, 'wav') }));
    return out;
  }

  // extras(t, files) → [{ kind, text }]: the other files' uses, only for when they are needed and each saying when —
  // instead of the finished video (the overlay, the background, the green screen with its key colour #00B140), or the
  // lyrics as separate subtitles (the finished video already shows them) — so following the numbered steps never puts
  // the same words on screen twice. Listed under 「必要なときだけ」 by the README and the guide.
  function extras(t, files) {
    const out = [];
    const add = (kind, key, param) => { if (nameOf(files, kind)) out.push({ kind, text: t(key, { [param]: nameOf(files, kind) }) }); };
    add('overlay', 'kit.help.3', 'overlay');
    add('bg', 'kit.help.bg', 'bg');
    add('green', 'kit.help.4', 'green');
    add('srt', 'kit.help.5', 'srt');
    return out;
  }

  function readmeIn(t, files, info) {
    const lines = [t('kit.readme.head'), ''];
    for (const f of files) {
      if (f.kind === 'readme') continue;
      lines.push('- ' + f.name + (LABELS[f.kind] ? ' : ' + t(LABELS[f.kind]) : ''));
    }
    lines.push('');
    steps(t, files, info).forEach((s, k) => lines.push(k + 1 + '. ' + s));
    lines.push('', t('kit.help.align'));
    const more = extras(t, files);
    if (more.length) lines.push('', t('kit.help.optional'), ...more.map((x) => '- ' + x.text));
    return lines;
  }

  // readme(files, { w, h, fps }) → README_Filmora.txt: the heading, every file with its label, the numbered steps of the
  // in-app guide (kit.help.*) with the real names, size and frame rate, the 0:00 line, then 「必要なときだけ」 and the
  // other files' uses (the key colour #00B140 is in the green screen's) — in Japanese, then in English. CRLF line
  // endings; the caller adds the BOM.
  function readme(files, info) {
    const ja = readmeIn(T.createT('ja', STRINGS), files, info);
    const en = readmeIn(T.createT('en', STRINGS), files, info);
    return ja.concat([RULE, ''], en).join(CRLF) + CRLF;
  }

  function utf8(text) { return new TextEncoder().encode(text); }

  // --- helpers -------------------------------------------------------------------------------------------------------

  function zipDate(d) {
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(),
      second: d.getSeconds() };
  }

  // The CRC-32 of a Blob, read in slices (a memory file is never copied whole).
  async function crcOfBlob(blob, signal) {
    let crc = 0;
    for (let at = 0; at < blob.size; at += CRC_SLICE) {
      J.checkAbort(signal);
      crc = Z.crc32(new Uint8Array(await blob.slice(at, at + CRC_SLICE).arrayBuffer()), crc);
    }
    return crc;
  }

  // The kit's AAC list: codecs.audioList (tests) without Opus (the kit never relies on Opus in MP4, §13.4), else AAC.
  function kitAudioList(codecs) {
    const list = codecs && Array.isArray(codecs.audioList) ? codecs.audioList : ['mp4a.40.2'];
    return list.filter((c) => c !== 'opus');
  }

  // Where the files go: a folder (DirSink) or memory sinks that become one ZIP.
  function createTarget(dir, folder) {
    const memory = [];                   // [{ name, sink }]
    return {
      dir,
      async file(name, kind) {
        if (dir) return dir.file(name);
        const sink = SINK.createMemorySink({ name, type: TYPES[kind] });
        memory.push({ name, sink });
        return sink;
      },
      memory,
      async abort() {
        if (dir) await dir.abort();
        for (const m of memory) await m.sink.abort();
      },
      folder,
    };
  }

  async function writeText(target, file, text) {
    const sink = await target.file(file.name, file.kind);
    await sink.write(utf8(text));
    return sink.close();
  }

  // The song as a WAV file: exactly audioFrames(N) frames of 16-bit stereo from t0, written in 4 MB pieces.
  async function writeWav(target, file, song, job, signal) {
    const rate = song.sampleRate;
    const frames = S.audioFrames(job.N, job.fps, rate);
    const channels = J.channelsOf(song);
    const start = Math.round(job.t0 * rate);
    const sink = await target.file(file.name, file.kind);
    await sink.write(WAV.pcm16Header(rate, frames, 2));
    for (let from = 0; from < frames; from += WAV_BLOCK) {
      J.checkAbort(signal);
      await sink.write(WAV.pcm16Data(channels, start + from, Math.min(WAV_BLOCK, frames - from), 2));
    }
    return sink.close();
  }

  // Memory files → one store-only ZIP (Blob parts, zip.addBlob), in the files' order.
  async function zipFiles(target, files, signal) {
    const name = target.folder + '.zip';
    const sink = SINK.createMemorySink({ name, type: 'application/zip' });
    const zip = Z.createZip((part) => sink.write(part), { date: zipDate(new Date()) });
    for (const f of files) {
      const blob = f.blob;
      await zip.addBlob(f.name, blob, { crc: await crcOfBlob(blob, signal) });
    }
    await zip.finish();
    const done = await sink.close();
    return { name, blob: done.blob, bytes: done.bytes };
  }

  // --- exportKit -----------------------------------------------------------------------------------------------------

  // exportKit({ engine, doc, audio: AudioBuffer | null, dir: DirSink | null, signal, onProgress, assets?, canvas?, lib?,
  //             codecs? }) → { files: [{ name, kind, bytes }], ms, audio: 'aac' | 'wav' | 'none', frames, bytes, folder,
  //                            codec, overlayCodec, name?, blob? }
  // The Filmora kit (DESIGN_2_1 §13.9). Files and names are export/schedule.kitFiles (§13.9's table, in its order):
  // the main MP4 (H.264 at CFR with a key frame every 2·fps, AAC where the browser encodes it), the overlay WebM
  // (the §13.5 transparent WebM, backdrop `clear`, no sound), the background MP4 (layers 'ground'), the green-screen MP4
  // (the document with backdrop `chroma`, quality max), then the song WAV (when the MP4 has no AAC), SRT (BOM, the
  // export range), LRC (song times) and README_Filmora.txt.
  // One pass over the timeline: two engine forks — eA (the document) and eG (backdrop chroma, only with the green
  // screen) — share one AssetStore (`assets.fork()`, when the caller passes its store; otherwise each fork makes its
  // own), so each source frame is decoded once. Per frame: await both forks' media frames, then render and encode main,
  // overlay, background, green, each with its own encoder and queue limit, all at ts(i) / frameDur(i).
  // `dir` (openDirectory / createDirSink) receives one file sink per file; without it (null) every file is a memory sink
  // and the result is one ZIP '<base>_filmora.zip' (`blob`, `name`: the caller downloads it). Progress: { i, N, eta,
  // phase } once per frame (phase 'video'), then phase 'files' (WAV, subtitles, README) and 'zip'. Cancel or any failure
  // closes every encoder and aborts every sink; a folder made by openDirectory is removed with what is in it.
  async function exportKit(opts) {
    const o = opts || {};
    const started = performance.now();
    const doc = o.doc;
    const target = createTarget(o.dir || null, S.kitFolder(doc));
    const lib = o.lib || globalThis.Mp4Muxer;
    if (typeof VideoEncoder !== 'function' || typeof VideoFrame !== 'function') {
      await target.abort();
      throw new S.ExportError('no-webcodecs', 'WebCodecs is not available');
    }
    const kit = S.kitOptions(doc.output);
    const store = o.assets && typeof o.assets.fork === 'function' ? o.assets.fork() : null;
    const jobs = [];
    const outputs = [];
    const say = (p) => { if (o.onProgress) o.onProgress(p); };
    try {
      const jobA = await J.openJob({ engine: o.engine, doc, format: 'kit', canvas: o.canvas, assets: store });
      jobs.push(jobA);
      J.checkAbort(o.signal);
      let jobG = null;
      if (kit.green) {
        const green = C.reduce(doc, { t: 'look.set', key: 'backdrop', v: 'chroma' });
        jobG = await J.openJob({ engine: o.engine, doc: green, format: 'kit', canvas: o.canvas, assets: store, replan: true });
        jobs.push(jobG);
        if (jobG.N !== jobA.N || jobG.t0 !== jobA.t0) throw new S.ExportError('encode', 'the green-screen plan has another length');
      }
      const { w, h, fps } = jobA;
      const bits = S.bitrate(w, h, fps, doc.output.quality);
      const main = await J.videoConfig(o.codecs, jobA, bits);
      const song = o.audio && doc.output.audio && doc.song ? o.audio : null;
      const acfg = song ? await J.audioConfig(o.codecs, song, kitAudioList(o.codecs)) : null;
      const files = S.kitFiles(doc, jobA.plan, { audioCodec: acfg ? acfg.codec : null, songReady: !!song });
      const fileOf = (kind) => files.find((f) => f.kind === kind) || null;
      let overlay = null;
      if (kit.overlay) {
        overlay = await J.vp9Config(o.codecs, w, h, fps, bits);
        if (!overlay) throw new S.ExportError('no-vp9', 'neither VP9 nor VP8 encodes ' + w + '×' + h + '@' + fps);
      }
      const greenConfig = jobG ? await J.videoConfig(o.codecs, jobG, S.bitrate(w, h, fps, 'max')) : null;
      J.checkAbort(o.signal);

      // one output per video file: its job (engine fork), surface, render options and encoder
      const add = async (kind, job, surface, ropts, make) => {
        const sink = await target.file(fileOf(kind).name, kind);
        outputs.push({ kind, job, surface, ropts, out: make(sink) });
      };
      await add('main', jobA, jobA.surface, jobA.ropts, (sink) => J.createMp4Output({ lib, sink, job: jobA, vcfg: main, acfg, song }));
      if (overlay) {
        await add('overlay', jobA, jobA.surfaceFor(true), jobA.options({ backdrop: 'clear' }),
          (sink) => WH.createAlphaOutput({ sink, job: jobA, config: overlay, audio: null }));
      }
      if (kit.bg) {
        await add('bg', jobA, jobA.surfaceFor(false), jobA.options({ layers: 'ground' }),
          (sink) => J.createMp4Output({ lib, sink, job: jobA, vcfg: main, acfg: null, song: null }));
      }
      if (jobG) {
        await add('green', jobG, jobG.surface, jobG.ropts,
          (sink) => J.createMp4Output({ lib, sink, job: jobG, vcfg: greenConfig, acfg: null, song: null }));
      }

      const progress = J.createProgress(jobA.N, (p) => say(Object.assign({ phase: 'video' }, p)));
      for (let i = 0; i < jobA.N; i++) {
        J.checkAbort(o.signal);
        for (const x of outputs) if (x.out.failure) throw x.out.failure;
        for (const job of jobs) await job.ready(i, o.signal);
        for (const x of outputs) {
          x.job.render(i, x.surface, x.ropts);
          await x.out.frame(i, x.kind === 'overlay' ? x.surface : x.surface.canvas);
        }
        progress.frame(i);
      }
      for (const x of outputs) await x.out.flush();
      J.checkAbort(o.signal);
      const written = new Map();
      for (const x of outputs) written.set(x.kind, await x.out.end());

      say({ i: jobA.N, N: jobA.N, eta: 0, phase: 'files' });
      const wav = fileOf('wav');
      if (wav) written.set('wav', await writeWav(target, wav, song, jobA, o.signal));
      if (kit.srt) {
        const { t0, t1 } = jobA;
        written.set('srt', await writeText(target, fileOf('srt'), SUB.BOM + SUB.srt(jobA.plan, { t0, t1 })));
      }
      if (kit.lrc) written.set('lrc', await writeText(target, fileOf('lrc'), SUB.lrc(jobA.plan, doc)));
      written.set('readme', await writeText(target, fileOf('readme'), SUB.BOM + readme(files, { w, h, fps })));
      J.checkAbort(o.signal);

      const list = files.map((f) => ({ name: f.name, kind: f.kind, bytes: written.get(f.kind).bytes }));
      const result = { files: list, audio: acfg ? 'aac' : wav ? 'wav' : 'none', frames: jobA.N, folder: target.folder,
        codec: main.codec, overlayCodec: overlay ? overlay.codec : null };
      if (target.dir) {
        await target.dir.close();
        result.folder = target.dir.name;
        result.bytes = list.reduce((sum, f) => sum + f.bytes, 0);
      } else {
        say({ i: jobA.N, N: jobA.N, eta: 0, phase: 'zip' });
        const zipped = await zipFiles(target, files.map((f) => ({ name: f.name, blob: written.get(f.kind).blob })), o.signal);
        result.name = zipped.name;
        result.blob = zipped.blob;
        result.bytes = zipped.bytes;
      }
      result.ms = performance.now() - started;
      return result;
    } catch (err) {
      for (const x of outputs) x.out.close();
      await target.abort();
      const failure = outputs.map((x) => x.out.failure).find(Boolean);
      throw J.exportFailure(err, o.signal, failure);
    } finally {
      for (const job of jobs) job.engine.dispose();
      if (store && typeof store.dispose === 'function') store.dispose();
    }
  }

  return { exportKit, readme, steps, extras, KEY_COLOUR };
});
