/* 文字PVメーカー v2 — original work. AI with the song's audio (Gemini only, after consent): transcribe, align, analyze (DESIGN §4.22.4, §4.22.6). */
MV.def('ai/song', ['audio/wav', 'audio/digest', 'core/doc', 'core/lyrics', 'ai/providers', 'ai/lyricio', 'ai/changes'],
  (W, DG, D, L, PR, IO, CH) => {
    'use strict';

    // ---- audio → request part --------------------------------------------------------------------------------------

    const AUDIO_RATE = 16000;                     // Gemini works on speech-rate audio; 16 kHz keeps the upload small
    const AUDIO_RATES = Object.freeze([16000, 12000, 8000]);
    const INLINE_MAX_BYTES = 14 * 1024 * 1024;    // raw bytes sent inline (base64 grows it by 4/3; the request limit is 20 MB)
    const WAV_HEADER = 44;
    const MIME = 'audio/wav';
    const FILES_UPLOAD = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
    const FILES_BASE = 'https://generativelanguage.googleapis.com/v1beta/';
    const POLL_TRIES = 60;                        // audio is usually ready at once; wait up to about a minute
    const POLL_MS = 1000;
    const B64_CHUNK = 3 * 16384;                  // a multiple of 3, so chunks encode without padding in between

    // 16 kHz, or a lower rate for long songs so that they still fit inline (16 kHz ≈ 7 min, 8 kHz ≈ 14 min); longer
    // songs keep 16 kHz and go through the Files API.
    function pickRate(seconds) {
      return AUDIO_RATES.find((r) => WAV_HEADER + seconds * r * 2 <= INLINE_MAX_BYTES) || AUDIO_RATES[0];
    }

    // Decoded channels → { bytes, mimeType, seconds, rate } (16-bit mono WAV).
    function audioFromChannels(channels, sampleRate, seconds) {
      const secs = seconds === undefined ? channels[0].length / sampleRate : seconds;
      const rate = pickRate(secs);
      return { bytes: W.encodeWav(channels, sampleRate, rate), mimeType: MIME, seconds: secs, rate };
    }

    // An AudioBuffer (or anything with numberOfChannels, getChannelData, sampleRate, duration) → audioFromChannels.
    function audioFromBuffer(buffer) {
      const channels = [];
      for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
      return audioFromChannels(channels, buffer.sampleRate, buffer.duration);
    }

    function toBase64(u8) {
      const parts = [];
      for (let i = 0; i < u8.length; i += B64_CHUNK) parts.push(DG.toBase64(u8.subarray(i, i + B64_CHUNK)));
      return parts.join('');
    }

    // What the consent card states: { mb (one decimal), seconds }.
    function audioSize(audio) {
      return { mb: Math.round(audio.bytes.length / (1024 * 1024) * 10) / 10, seconds: audio.seconds };
    }

    // The audio as a request part: inline when small, else uploaded with the Files API.
    // opts = { audio, apiKey, fetchImpl, signal, onStage(stage), inlineMax, sleep }
    async function audioPart(opts) {
      const max = opts.inlineMax === undefined ? INLINE_MAX_BYTES : opts.inlineMax;
      const audio = opts.audio;
      if (audio.bytes.length <= max) return { inlineData: { mimeType: audio.mimeType, data: toBase64(audio.bytes) } };
      const f = await uploadFile(Object.assign({}, opts, { bytes: audio.bytes, mimeType: audio.mimeType }));
      return { fileData: { mimeType: audio.mimeType, fileUri: f.uri } };
    }

    function doFetchOf(opts) {
      if (typeof opts.fetchImpl === 'function') return opts.fetchImpl;
      const g = typeof globalThis !== 'undefined' ? globalThis : null;
      if (g && typeof g.fetch === 'function') return (url, init) => g.fetch(url, init);
      return null;
    }

    function wait(ms, signal) {
      return new Promise((resolve, reject) => {
        if (signal && signal.aborted) { reject(new PR.AIError('aborted')); return; }
        const timer = setTimeout(resolve, ms);
        if (signal && typeof signal.addEventListener === 'function') {
          signal.addEventListener('abort', () => { clearTimeout(timer); reject(new PR.AIError('aborted')); }, { once: true });
        }
      });
    }

    // A failed upload request → code. Key problems and limits keep their codes; everything else is 'upload'. The
    // server's message is scrubbed of the key like every other message.
    function uploadError(r, j, apiKey) {
      const e = PR.geminiError(r, j, apiKey);
      return ['auth', 'rate', 'server'].includes(e.code) ? e : new PR.AIError('upload', 'upload failed', { status: r.status });
    }

    // The file is usable once it has a uri and is ACTIVE (a record without a state is taken as ready).
    function readyFile(file) {
      if (!file || typeof file.uri !== 'string' || !file.uri) throw new PR.AIError('upload', 'the uploaded file has no uri');
      if (file.state !== undefined && file.state !== 'ACTIVE') throw new PR.AIError('upload', 'file state ' + String(file.state));
      return file;
    }

    // Resumable upload, then wait until the file is ACTIVE. → the file record ({ name, uri, state, … }).
    async function uploadFile(opts) {
      const doFetch = doFetchOf(opts);
      const signal = opts.signal;
      const sleep = typeof opts.sleep === 'function' ? opts.sleep : (ms) => wait(ms, signal);
      const req = async (url, init) => {
        if (!doFetch) throw new PR.AIError('network', 'fetch is not available');
        try {
          const r = await doFetch(url, Object.assign({ signal }, init));
          if (!r) throw new Error('no response');
          return r;
        } catch (e) {
          throw new PR.AIError(e && e.name === 'AbortError' ? 'aborted' : 'network', PR.scrub(e && e.message, opts.apiKey));
        }
      };
      const json = async (r) => { try { return await r.json(); } catch (e) { return null; } };
      if (opts.onStage) opts.onStage('upload');
      const start = await req(FILES_UPLOAD, {
        method: 'POST',
        headers: {
          'x-goog-api-key': opts.apiKey, 'content-type': 'application/json', 'x-goog-upload-protocol': 'resumable',
          'x-goog-upload-command': 'start', 'x-goog-upload-header-content-length': String(opts.bytes.length),
          'x-goog-upload-header-content-type': opts.mimeType,
        },
        body: JSON.stringify({ file: { display_name: opts.displayName || 'song' } }),
      });
      if (!start.ok) throw uploadError(start, await json(start), opts.apiKey);
      const uploadUrl = start.headers && typeof start.headers.get === 'function' ? start.headers.get('x-goog-upload-url') : null;
      if (!uploadUrl) throw new PR.AIError('upload', 'upload could not start', { status: start.status });
      const done = await req(uploadUrl, {
        method: 'POST', headers: { 'x-goog-upload-offset': '0', 'x-goog-upload-command': 'upload, finalize' }, body: opts.bytes,
      });
      const j = await json(done);
      if (!done.ok) throw uploadError(done, j, opts.apiKey);
      let file = j && j.file;
      if (!file || !file.uri) throw new PR.AIError('upload', 'upload failed', { status: done.status });
      if (opts.onStage) opts.onStage('process');
      for (let k = 0; file.state === 'PROCESSING' && k < POLL_TRIES; k++) {
        await sleep(POLL_MS);
        const g = await req(FILES_BASE + file.name, { method: 'GET', headers: { 'x-goog-api-key': opts.apiKey } });
        const body = await json(g);
        // a failed poll is an error of its own, never a file record
        if (!g.ok) throw uploadError(g, body, opts.apiKey);
        if (body && typeof body === 'object') file = Object.assign({}, file, body);
      }
      return readyFile(file);
    }

    // ---- times -----------------------------------------------------------------------------------------------------

    // "83.5", 83.5, "1:23.5", "01:23", "0:01:23.5" → seconds; anything else → NaN.
    function seconds(v) {
      if (typeof v === 'number') return v;
      const s = String(v === null || v === undefined ? '' : v).trim();
      if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
      const m = s.match(/^(?:(\d+):)?(\d{1,3}):(\d{1,2}(?:\.\d+)?)$/);
      return m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
    }

    const lrcTag = L.lrcTag;
    const TIME = Object.freeze({ type: 'string' });   // "mm:ss.ss": both services handle strings more reliably than floats
    function outLang(lang) { return lang === 'en' ? 'English' : 'Japanese'; }
    function round(x, k) { return Math.round(x * k) / k; }

    // ---- 1) 書き起こし (transcribe) ------------------------------------------------------------------------------------

    const TRANSCRIBE_SCHEMA = Object.freeze({
      type: 'object', additionalProperties: false, required: ['language', 'lines', 'note'],
      properties: {
        language: { type: 'string' }, note: { type: 'string' },
        lines: {
          type: 'array',
          items: { type: 'object', additionalProperties: false, required: ['start', 'text'], properties: { start: TIME, text: { type: 'string' } } },
        },
      },
    });

    function transcribeRequest(uiLang) {
      return {
        system: [
          'You transcribe the sung lyrics of a song for a lyric-video tool.',
          'Write the lyrics exactly as they are sung, in the language and writing system of the song (Japanese in kanji and kana '
            + 'as a lyric sheet would, English as English). Do not translate and do not add anything that is not sung.',
          'Split them the way a lyric sheet does: one entry per sung line or phrase (usually 2–6 seconds). Repeat choruses every '
            + 'time they are sung.',
          '"start" is when the singing of that line begins, as mm:ss.ss from the start of the audio. Listen carefully and be '
            + 'precise to a tenth of a second.',
          'Leave out instrumental parts, and put nothing in "text" that is not sung. If a word is unclear, write your best guess.',
          '"note": one short sentence about anything uncertain, in ' + outLang(uiLang) + '.',
        ].join('\n'),
        prompt: 'Transcribe the lyrics of this song with a start time for each line.',
        schema: TRANSCRIBE_SCHEMA, effort: 'medium',
      };
    }

    // One lyric row each: no line breaks, no syntax characters (/ * | → space), no leading # (→ ＃), no trailing ! (→ ！).
    function cleanLine(text) {
      return String(text || '').replace(/[\r\n]+/g, ' ').replace(/[/*|]/g, ' ').replace(/\s+/g, ' ').trim()
        .replace(/^#/, '＃').replace(/!$/, '！');
    }

    // The transcript as lyric box text: `[mm:ss.xx]text` rows (or plain rows without times).
    function transcriptText(lines, withTimes = true) {
      return lines.map((l) => L.renderRow({ stamps: withTimes ? [l.start] : [], text: l.text })).join('\n');
    }

    // → { lines: [{ start, text }], text (with LRC stamps), plain (without), language, note, warnings }; times sorted,
    // bad times dropped (warnings as [stringKey, params]).
    function transcriptLines(json, duration) {
      const warnings = [];
      const lines = [];
      for (const l of (json && Array.isArray(json.lines)) ? json.lines : []) {
        const text = cleanLine(l && l.text);
        if (!text) continue;
        const t = seconds(l.start);
        if (!Number.isFinite(t) || t < 0 || (duration && t > duration + 1)) {
          warnings.push(['ai.warn.badTime', { time: String(l.start) }]);
          continue;
        }
        lines.push({ start: round(t, 100), text });
      }
      lines.sort((a, b) => a.start - b.start);
      return {
        lines, text: transcriptText(lines, true), plain: transcriptText(lines, false), warnings,
        language: String((json && json.language) || ''), note: String((json && json.note) || '').slice(0, 200),
      };
    }

    // The transcript as one change: 'replace' the lyrics or 'append' them. opts = { rev, withTimes = true }.
    function transcriptChange(doc, result, mode, opts) {
      const o = opts || {};
      const text = o.withTimes === false ? result.plain : result.text;
      const m = mode === 'append' ? 'append' : 'replace';
      return CH.make(doc, {
        id: 'rows:' + m, kind: 'rows', scope: 'rows', mode: m, from: IO.sheetText(doc), to: text,
        label: ['ai.ch.rows.' + m, { n: result.lines.length }],
      }, o);
    }

    // ---- 2) タイミング合わせ (align) -----------------------------------------------------------------------------------

    const ALIGN_SCHEMA = Object.freeze({
      type: 'object', additionalProperties: false, required: ['lines', 'note'],
      properties: {
        note: { type: 'string' },
        lines: {
          type: 'array',
          items: { type: 'object', additionalProperties: false, required: ['i', 'start'], properties: { i: { type: 'integer' }, start: TIME } },
        },
      },
    });

    function alignRequest(doc, plan, uiLang) {
      const lines = plan.lines.map((l, i) => ({ i, lineId: l.id, text: l.text }));
      return {
        system: [
          'You align lyrics to a song for a lyric-video tool. You are given the lyric lines (numbered from 0) in the order they are sung.',
          'For every line, find when its singing begins in the audio and give it as mm:ss.ss from the start of the audio, precise '
            + 'to a tenth of a second.',
          'Times must increase from line to line. If a line is not sung or you cannot find it, leave it out. Lines that repeat '
            + '(choruses) each get the time of that occurrence, in order.',
          '"note": one short sentence about anything uncertain, in ' + outLang(uiLang) + '.',
        ].join('\n'),
        prompt: 'Lyric lines (number: text):\n' + lines.map((l) => l.i + ': ' + l.text).join('\n'),
        schema: ALIGN_SCHEMA, effort: 'medium', lines,
      };
    }

    // → { changes: time changes (pins by 'ai' on line/<id>:start), warnings, note }. Times must increase strictly, lie
    // within the song and move a line by ≥ 0.05 s. A line whose start comes from an LRC stamp gets `overLrc: true`
    // (the pin wins over the stamp; the review row says so). Validate against the doc and plan the request was built
    // from; opts = { rev, lines } (lines: the request's i → lineId list).
    function alignChanges(doc, plan, json, duration, opts) {
      const o = opts || {};
      const warnings = [];
      const changes = [];
      const lineAt = CH.lineResolver(plan, Array.isArray(o.lines) ? o.lines : null);
      const changeOpts = { rev: o.rev, srcs: CH.rowSrcs(doc) };
      const seen = new Set();
      let last = -1;
      const list = ((json && Array.isArray(json.lines)) ? json.lines : [])
        .map((l) => ({ i: l && Number.isInteger(l.i) ? l.i : -1, t: seconds(l && l.start), raw: l && l.start }))
        .filter((l) => l.i >= 0)
        .sort((a, b) => a.i - b.i);
      for (const l of list) {
        if (seen.has(l.i)) continue;
        const found = lineAt(l.i);
        // numbers past the end were never sent (dropped silently, as before); lines edited since are reported
        if (found.warn) { if (found.warn[0] !== 'ai.warn.notLine') warnings.push(found.warn); continue; }
        seen.add(l.i);
        if (!Number.isFinite(l.t) || l.t < 0 || (duration && l.t > duration) || l.t <= last) {
          warnings.push(['ai.warn.lineTime', { n: l.i + 1, time: String(l.raw) }]);
          continue;
        }
        last = l.t;
        const line = found.line;
        const to = round(l.t, 100);
        if (Math.abs(line.t0 - to) < 0.05) continue;
        const overLrc = !!(line.by && line.by.start === 'lrc');
        changes.push(CH.make(doc, {
          id: 'time:' + line.id, kind: 'time', scope: 'line', lineId: line.id, rowId: line.row, n: l.i + 1,
          path: 'line/' + line.id + ':start', from: line.t0, to, overLrc,
          fromSource: line.by ? line.by.start : 'auto',
          label: [overLrc ? 'ai.ch.time.lrc' : 'ai.ch.time', { n: l.i + 1, from: line.t0, to }],
        }, changeOpts));
      }
      return { changes, warnings, note: String((json && json.note) || '').slice(0, 200) };
    }

    // ---- 3) 曲の分析 (analyze) -----------------------------------------------------------------------------------------

    const SECTION_KINDS = D.SECTION_KINDS;       // core/doc validates doc.song.info with the same list
    const MAX_SECTIONS = 40;
    const MAX_HIGHLIGHTS = 8;

    const ANALYZE_SCHEMA = Object.freeze({
      type: 'object', additionalProperties: false, required: ['summary', 'mood', 'bpm', 'sections', 'highlights'],
      properties: {
        summary: { type: 'string' }, mood: { type: 'string' }, bpm: { type: 'number' },
        sections: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['kind', 'start', 'end'],
            properties: { kind: { type: 'string', enum: SECTION_KINDS.slice() }, start: TIME, end: TIME },
          },
        },
        highlights: {
          type: 'array',
          items: { type: 'object', additionalProperties: false, required: ['time', 'what'], properties: { time: TIME, what: { type: 'string' } } },
        },
      },
    });

    function analyzeRequest(uiLang) {
      return {
        system: [
          'You analyze a song for a lyric-video tool, so that the video can follow the music.',
          'Give: "sections" covering the whole song in order (intro, verse, prechorus, chorus, bridge, interlude, solo, outro, '
            + 'or other) with start and end as mm:ss.ss;',
          '"highlights": up to 8 moments where the music hits hard or changes (drops, breaks, the first chorus, key changes), '
            + 'each with a short description;',
          '"bpm": the tempo in beats per minute (0 if unclear); "mood": a few words about the feel; "summary": one or two '
            + 'sentences about the song\'s sound and energy.',
          'Write "mood", "summary" and each "what" in ' + outLang(uiLang) + '.',
        ].join('\n'),
        prompt: 'Analyze this song.',
        schema: ANALYZE_SCHEMA, effort: 'medium',
      };
    }

    // The analysis kept as doc.song.info: numbers and short labels only; sections sorted and capped at 40, highlights at
    // 8, bpm kept only in (30, 300) (else 0).
    function songInfo(json, duration) {
      const time = (v) => {
        const x = seconds(v);
        return Number.isFinite(x) && x >= 0 && (!duration || x <= duration + 1) ? round(x, 10) : NaN;
      };
      const sections = ((json && Array.isArray(json.sections)) ? json.sections : [])
        .map((s) => ({ kind: SECTION_KINDS.includes(s && s.kind) ? s.kind : 'other', start: time(s && s.start), end: time(s && s.end) }))
        .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
        .sort((a, b) => a.start - b.start)
        .slice(0, MAX_SECTIONS);
      const highlights = ((json && Array.isArray(json.highlights)) ? json.highlights : [])
        .map((h) => ({ time: time(h && h.time), what: String((h && h.what) || '').slice(0, 60) }))
        .filter((h) => Number.isFinite(h.time))
        .slice(0, MAX_HIGHLIGHTS);
      const bpm = Number(json && json.bpm);
      return {
        summary: String((json && json.summary) || '').slice(0, 300), mood: String((json && json.mood) || '').slice(0, 80),
        bpm: bpm > 30 && bpm < 300 ? round(bpm, 10) : 0, sections, highlights, duration: duration ? round(duration, 10) : 0,
      };
    }

    // → { info, changes: [songInfo change], warnings }. opts = { rev }.
    function analyzeChanges(doc, json, duration, opts) {
      const info = songInfo(json, duration);
      if (!doc.song) return { info, changes: [], warnings: [['ai.warn.noSong', {}]] };
      const change = CH.make(doc, {
        id: 'songInfo', kind: 'songInfo', scope: 'work', from: doc.song.info || null, to: info, label: ['ai.ch.songInfo', {}],
      }, opts);
      return { info, changes: [change], warnings: [] };
    }

    // Which lyric lines fall in each section (by the plan's line start times) → text for the look prompts; '' without
    // an analysis. Sections and highlights without finite times are skipped (the document validator refuses them, but
    // a prompt must never fail on one).
    function songContext(doc, plan) {
      const s = doc.song && doc.song.info;
      const finite = (x) => typeof x === 'number' && Number.isFinite(x);
      const sections = s && Array.isArray(s.sections)
        ? s.sections.filter((sec) => sec && finite(sec.start) && finite(sec.end)) : [];
      if (!sections.length) return '';
      const lineIn = (sec) => plan.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.t0 >= sec.start - 0.3 && l.t0 < sec.end).map(({ i }) => i);
      const secText = sections.map((sec) => {
        const ls = lineIn(sec);
        return String(sec.kind) + ' ' + sec.start.toFixed(1) + '-' + sec.end.toFixed(1) + 's' + (ls.length ? ' lines ' + ls[0] + '-' + ls[ls.length - 1] : '');
      }).join('; ');
      const highlights = Array.isArray(s.highlights) ? s.highlights.filter((h) => h && finite(h.time)) : [];
      const hl = highlights.length
        ? ' Highlights: ' + highlights.map((h) => h.time.toFixed(1) + 's ' + String(h.what || '')).join('; ') + '.' : '';
      return 'Song analysis (from the audio): ' + (s.summary || '') + ' Mood: ' + (s.mood || '') + '. BPM: ' + (s.bpm || 'unknown')
        + '. Sections: ' + secText + '.' + hl;
    }

    return {
      AUDIO_RATE, AUDIO_RATES, INLINE_MAX_BYTES, FILES_UPLOAD, FILES_BASE, SECTION_KINDS,
      TRANSCRIBE_SCHEMA, ALIGN_SCHEMA, ANALYZE_SCHEMA,
      encodeWav: W.encodeWav, pickRate, audioFromChannels, audioFromBuffer, toBase64, audioSize, audioPart, uploadFile,
      seconds, lrcTag, transcribeRequest, transcriptLines, transcriptText, transcriptChange, alignRequest, alignChanges,
      analyzeRequest, songInfo, analyzeChanges, songContext,
    };
  });
