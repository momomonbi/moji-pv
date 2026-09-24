/* ============================================================
   文字PVメーカー — AI with the song's audio (optional, Gemini only)
   Only when the user presses one of these buttons, and has agreed to it, the song's audio is sent to Google Gemini:
     - 曲から歌詞を書き起こす: the sung lyrics with a start time per line (-> lyrics with LRC tags)
     - 歌詞のタイミングを曲に合わせる: a start time for each line of the lyrics already typed in (-> 行の開始時刻)
     - 曲を分析する: sections (intro / verse / chorus …), mood and tempo, kept with the project and given to the
       AI proposals and one-line edits as context
   The audio goes as 16 kHz mono WAV made from the decoded song (small, and a format Gemini reads), inline in the request
   when it is small enough, otherwise through the Gemini Files API.
   No DOM code here; the buttons live in 13_ai_ui.js.
   ============================================================ */
(() => {
'use strict';
const AI = J.AI;
const AIError = AI.AIError;

/* ---------------- audio -> request part ---------------- */
AI.AUDIO_RATE = 16000;                       // Gemini works on speech-rate audio; 16 kHz keeps the upload small
AI.INLINE_MAX_BYTES = 14 * 1024 * 1024;      // raw bytes sent inline (base64 grows it by 4/3; the request limit is 20 MB)
/* decoded channels -> 16-bit mono WAV at `rate`, averaging the source samples that fall into each output sample */
AI.encodeWav = (channels, sampleRate, rate = AI.AUDIO_RATE) => {
  const nIn = channels[0].length, ratio = sampleRate / rate, nOut = Math.max(0, Math.floor(nIn / ratio));
  const out = new DataView(new ArrayBuffer(44 + nOut * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + nOut * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, nOut * 2, true);
  const nc = channels.length;
  let peak = 0;
  const mono = new Float32Array(nOut);
  for (let j = 0; j < nOut; j++) {
    const a = Math.floor(j * ratio), b = Math.max(a + 1, Math.min(nIn, Math.floor((j + 1) * ratio)));
    let s = 0;
    for (let c = 0; c < nc; c++) { const d = channels[c]; for (let i = a; i < b; i++) s += d[i]; }
    const v = s / ((b - a) * nc); mono[j] = v; const av = v < 0 ? -v : v; if (av > peak) peak = av;
  }
  const gain = peak > 0 && peak < 0.5 ? 0.5 / peak : 1;     // quiet masters are lifted a little; nothing is clipped
  for (let j = 0; j < nOut; j++) { const v = Math.max(-1, Math.min(1, mono[j] * gain)); out.setInt16(44 + j * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
  return new Uint8Array(out.buffer);
};
/* the song as WAV: 16 kHz, or a lower rate for long songs so that it still fits inline (16 kHz ≈ 7 min, 8 kHz ≈ 14 min);
   longer songs keep 16 kHz and go through the Files API */
AI.AUDIO_RATES = [16000, 12000, 8000];
AI.pickRate = (seconds) => AI.AUDIO_RATES.find(r => 44 + seconds * r * 2 <= AI.INLINE_MAX_BYTES) || AI.AUDIO_RATES[0];
AI.audioFromBuffer = (buffer) => {
  const ch = []; for (let c = 0; c < buffer.numberOfChannels; c++) ch.push(buffer.getChannelData(c));
  const rate = AI.pickRate(buffer.duration);
  return { bytes: AI.encodeWav(ch, buffer.sampleRate, rate), mimeType: 'audio/wav', seconds: buffer.duration, rate };
};
AI.toBase64 = (u8) => {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
};
/* the audio as a request part: inline when small, else uploaded with the Files API (resumable upload, then wait until ACTIVE) */
AI.audioPart = async ({ audio, apiKey, fetchImpl, signal, onStage }) => {
  if (audio.bytes.length <= AI.INLINE_MAX_BYTES) return { inlineData: { mimeType: audio.mimeType, data: AI.toBase64(audio.bytes) } };
  const f = await AI.uploadFile({ bytes: audio.bytes, mimeType: audio.mimeType, apiKey, fetchImpl, signal, onStage });
  return { fileData: { mimeType: audio.mimeType, fileUri: f.uri } };
};
AI.FILES_UPLOAD = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
AI.FILES_BASE = 'https://generativelanguage.googleapis.com/v1beta/';
AI.uploadFile = async ({ bytes, mimeType, apiKey, fetchImpl, signal, onStage, displayName = 'song' }) => {
  const doFetch = fetchImpl || fetch;
  const req = async (url, init) => {
    try { return await doFetch(url, Object.assign({ signal }, init)); }
    catch (e) { throw new AIError(e && e.name === 'AbortError' ? 'aborted' : 'network', e && e.message); }
  };
  if (onStage) onStage('upload');
  const start = await req(AI.FILES_UPLOAD, { method: 'POST', headers: {
    'x-goog-api-key': apiKey, 'content-type': 'application/json', 'x-goog-upload-protocol': 'resumable', 'x-goog-upload-command': 'start',
    'x-goog-upload-header-content-length': String(bytes.length), 'x-goog-upload-header-content-type': mimeType,
  }, body: JSON.stringify({ file: { display_name: displayName } }) });
  const uploadUrl = start.headers && start.headers.get && start.headers.get('x-goog-upload-url');
  if (!start.ok || !uploadUrl) throw new AIError(start.ok ? 'upload' : 'auth', 'upload could not start', { status: start.status });
  const done = await req(uploadUrl, { method: 'POST', headers: { 'x-goog-upload-offset': '0', 'x-goog-upload-command': 'upload, finalize' }, body: bytes });
  const j = await done.json().catch(() => null);
  let file = j && j.file;
  if (!done.ok || !file || !file.uri) throw new AIError('upload', 'upload failed', { status: done.status });
  if (onStage) onStage('process');
  for (let k = 0; file.state === 'PROCESSING' && k < 60; k++) {          // audio is usually ready at once; wait up to ~1 minute
    await new Promise(r => setTimeout(r, 1000));
    const g = await req(AI.FILES_BASE + file.name, { method: 'GET', headers: { 'x-goog-api-key': apiKey } });
    file = (await g.json().catch(() => null)) || file;
  }
  if (file.state && file.state !== 'ACTIVE') throw new AIError('upload', 'file state ' + file.state);
  return file;
};

/* ---------------- times ---------------- */
/* "83.5", 83.5, "1:23.5", "01:23", "0:01:23.5" -> seconds; anything else -> NaN */
AI.seconds = (v) => {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return +s;
  const m = s.match(/^(?:(\d+):)?(\d{1,3}):(\d{1,2}(?:\.\d+)?)$/);
  return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) : NaN;
};
AI.lrcTag = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}]`; };
const TIME = { type: 'string' };                 // "mm:ss.ss" — both services handle strings more reliably than bare floats here

/* ---------------- 1) 曲から歌詞を書き起こす ---------------- */
AI.TRANSCRIBE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['language', 'lines', 'note'],
  properties: {
    language: { type: 'string' }, note: { type: 'string' },
    lines: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['start', 'text'], properties: { start: TIME, text: { type: 'string' } } } },
  },
};
AI.transcribeRequest = (uiLang) => ({
  system: `You transcribe the sung lyrics of a song for a lyric-video tool.
Write the lyrics exactly as they are sung, in the language and writing system of the song (Japanese in kanji and kana as a lyric sheet would, English as English). Do not translate and do not add anything that is not sung.
Split them the way a lyric sheet does: one entry per sung line or phrase (usually 2–6 seconds). Repeat choruses every time they are sung.
"start" is when the singing of that line begins, as mm:ss.ss from the start of the audio. Listen carefully and be precise to a tenth of a second.
Leave out instrumental parts, and put nothing in "text" that is not sung. If a word is unclear, write your best guess.
"note": one short sentence about anything uncertain, in ${uiLang === 'en' ? 'English' : 'Japanese'}.`,
  prompt: 'Transcribe the lyrics of this song with a start time for each line.',
  schema: AI.TRANSCRIBE_SCHEMA, effort: 'medium',
});
/* -> { lines: [{start, text}], lyrics (with LRC tags), warnings } ; times sorted, invalid ones dropped */
AI.transcriptLines = (json, duration) => {
  const warn = [];
  const out = [];
  for (const l of (json && json.lines) || []) {
    // one lyric line each: no line breaks, no lyric-syntax characters, and no leading # (that would make it a comment)
    const text = String(l.text || '').replace(/[\r\n]+/g, ' ').replace(/[\/*|]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^#/, '＃');
    const t = AI.seconds(l.start);
    if (!text) continue;
    if (!isFinite(t) || t < 0 || (duration && t > duration + 1)) { warn.push(`bad time ${l.start}`); continue; }
    out.push({ start: Math.round(t * 100) / 100, text });
  }
  out.sort((a, b) => a.start - b.start);
  return { lines: out, warnings: warn, language: String((json && json.language) || ''), note: String((json && json.note) || '').slice(0, 200) };
};
AI.transcriptLyrics = (lines, withTimes = true) => lines.map(l => (withTimes ? AI.lrcTag(l.start) : '') + l.text.replace(/!$/, '！')).join('\n');

/* ---------------- 2) 歌詞のタイミングを曲に合わせる ---------------- */
AI.ALIGN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['lines', 'note'],
  properties: { note: { type: 'string' }, lines: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['i', 'start'], properties: { i: { type: 'integer' }, start: TIME } } } },
};
AI.alignRequest = (project, plan, uiLang) => {
  const lines = plan.lines.map(l => ({ i: l.index, text: l.text }));
  return {
    system: `You align lyrics to a song for a lyric-video tool. You are given the lyric lines (numbered from 0) in the order they are sung.
For every line, find when its singing begins in the audio and give it as mm:ss.ss from the start of the audio, precise to a tenth of a second.
Times must increase from line to line. If a line is not sung or you cannot find it, leave it out. Lines that repeat (choruses) each get the time of that occurrence, in order.
"note": one short sentence about anything uncertain, in ${uiLang === 'en' ? 'English' : 'Japanese'}.`,
    prompt: `Lyric lines (number: text):\n${lines.map(l => `${l.i}: ${l.text}`).join('\n')}`,
    schema: AI.ALIGN_SCHEMA, effort: 'medium', lines,
  };
};
/* -> changes [{kind:'time', i, from, to}] (to in seconds) for lines whose start moves; out-of-order times are dropped */
AI.alignChanges = (project, plan, json, duration) => {
  const warn = [], out = [];
  const n = plan.lines.length, seen = new Set();
  let last = -1;
  const list = ((json && json.lines) || []).map(l => ({ i: l.i | 0, t: AI.seconds(l.start) })).filter(l => l.i >= 0 && l.i < n).sort((a, b) => a.i - b.i);
  for (const l of list) {
    if (seen.has(l.i)) continue; seen.add(l.i);
    if (!isFinite(l.t) || l.t < 0 || (duration && l.t > duration) || l.t <= last) { warn.push(`line ${l.i}: time ${l.t}`); continue; }
    last = l.t;
    const from = plan.lines[l.i].start, to = Math.round(l.t * 100) / 100;
    if (Math.abs(from - to) >= 0.05) out.push({ kind: 'time', i: l.i, from, to });
  }
  return { changes: out, warnings: warn, note: String((json && json.note) || '').slice(0, 200) };
};
AI.hasLrc = (project) => J.parseLyrics(project.lyrics).lines.some(l => l.lrc != null);
AI.applyTimes = (project, changes) => {
  const P = JSON.parse(JSON.stringify(project));
  P.timing = Object.assign({}, P.timing, { lineTimes: Object.assign({}, (P.timing && P.timing.lineTimes) || {}) });
  for (const c of changes) P.timing.lineTimes[c.i] = c.to;
  return P;
};

/* ---------------- 3) 曲を分析する ---------------- */
AI.SECTION_KINDS = ['intro', 'verse', 'prechorus', 'chorus', 'bridge', 'interlude', 'solo', 'outro', 'other'];
AI.ANALYZE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'mood', 'bpm', 'sections', 'highlights'],
  properties: {
    summary: { type: 'string' }, mood: { type: 'string' }, bpm: { type: 'number' },
    sections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'start', 'end'], properties: { kind: { type: 'string', enum: AI.SECTION_KINDS }, start: TIME, end: TIME } } },
    highlights: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['time', 'what'], properties: { time: TIME, what: { type: 'string' } } } },
  },
};
AI.analyzeRequest = (uiLang) => ({
  system: `You analyze a song for a lyric-video tool, so that the video can follow the music.
Give: "sections" covering the whole song in order (intro, verse, prechorus, chorus, bridge, interlude, solo, outro, or other) with start and end as mm:ss.ss;
"highlights": up to 8 moments where the music hits hard or changes (drops, breaks, the first chorus, key changes), each with a short description;
"bpm": the tempo in beats per minute (0 if unclear); "mood": a few words about the feel; "summary": one or two sentences about the song's sound and energy.
Write "mood", "summary" and each "what" in ${uiLang === 'en' ? 'English' : 'Japanese'}.`,
  prompt: 'Analyze this song.',
  schema: AI.ANALYZE_SCHEMA, effort: 'medium',
});
/* -> songInfo kept on the project: numbers and short labels only */
AI.songInfo = (json, duration) => {
  const t = v => { const x = AI.seconds(v); return isFinite(x) && x >= 0 && (!duration || x <= duration + 1) ? Math.round(x * 10) / 10 : NaN; };
  const sections = ((json && json.sections) || []).map(s => ({ kind: AI.SECTION_KINDS.includes(s.kind) ? s.kind : 'other', start: t(s.start), end: t(s.end) }))
    .filter(s => isFinite(s.start) && isFinite(s.end) && s.end > s.start).sort((a, b) => a.start - b.start).slice(0, 40);
  const highlights = ((json && json.highlights) || []).map(h => ({ time: t(h.time), what: String(h.what || '').slice(0, 60) })).filter(h => isFinite(h.time)).slice(0, 8);
  const bpm = +(json && json.bpm) > 30 && +(json && json.bpm) < 300 ? Math.round(+json.bpm * 10) / 10 : 0;
  return { summary: String((json && json.summary) || '').slice(0, 300), mood: String((json && json.mood) || '').slice(0, 80), bpm, sections, highlights, duration: duration ? Math.round(duration * 10) / 10 : 0 };
};
/* which lyric lines fall in each section (by the plan's line start times) -> text for the look prompts */
AI.songContext = (project, plan) => {
  const s = project.songInfo; if (!s || !s.sections || !s.sections.length) return '';
  const lineIn = sec => plan.lines.filter(l => l.start >= sec.start - 0.3 && l.start < sec.end).map(l => l.index);
  const secText = s.sections.map(sec => { const ls = lineIn(sec); return `${sec.kind} ${sec.start.toFixed(1)}-${sec.end.toFixed(1)}s${ls.length ? ' lines ' + ls[0] + '-' + ls[ls.length - 1] : ''}`; }).join('; ');
  return `Song analysis (from the audio): ${s.summary} Mood: ${s.mood}. BPM: ${s.bpm || 'unknown'}. Sections: ${secText}.` +
    (s.highlights.length ? ` Highlights: ${s.highlights.map(h => `${h.time.toFixed(1)}s ${h.what}`).join('; ')}.` : '');
};
})();
