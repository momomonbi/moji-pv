/* ============================================================
   文字PVメーカー — AI アシスト panel (optional)
   Settings (service, model, API key), the three AI features and their change lists.
   Nothing is applied until the user picks changes; every apply can be undone.
   The key stays in this browser (session storage, or local storage when the user ticks 記憶する) and is
   sent only to the chosen AI service. It is never put in the project file.
   ============================================================ */
(() => {
'use strict';
if (typeof document === 'undefined' || !document.getElementById('aiPanel') || !J.AI) return;
const $ = id => document.getElementById(id);
const AI = J.AI;
const LS_SETTINGS = 'mojipv.ai.settings', KEY = p => 'mojipv.ai.key.' + p;
const USD_JPY = 150;                                    // for the rough yen figure next to the dollar cost
const UI_LANG = document.documentElement.lang === 'en' ? 'en' : 'ja';
const st = { ctl: null, undo: [], proposals: null, lastApplied: null, timer: 0 };
const api = () => J.uiApi;
const P = () => J.ui.project;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fill = (tpl, o) => tpl.replace(/\{(\w+)\}/g, (_, k) => (o[k] != null ? o[k] : ''));
const store = (area) => { try { return window[area]; } catch (e) { return null; } };

/* ---------------- settings ---------------- */
function settings() {
  let s = null; try { s = JSON.parse(store('localStorage').getItem(LS_SETTINGS) || 'null'); } catch (e) {}
  s = Object.assign({ provider: AI.DEFAULT_PROVIDER, models: {}, remember: false }, s || {});
  if (!AI.PROVIDERS[s.provider]) s.provider = AI.DEFAULT_PROVIDER;
  return s;
}
function saveSettings(s) { try { store('localStorage').setItem(LS_SETTINGS, JSON.stringify(s)); } catch (e) {} }
function modelOf(s) { return (s.models && s.models[s.provider]) || AI.PROVIDERS[s.provider].defaultModel; }
function getKey(p) {
  try { return store('sessionStorage').getItem(KEY(p)) || store('localStorage').getItem(KEY(p)) || ''; } catch (e) { return ''; }
}
function setKey(p, key, remember) {
  try {
    store('sessionStorage').removeItem(KEY(p)); store('localStorage').removeItem(KEY(p));
    if (key) (remember ? store('localStorage') : store('sessionStorage')).setItem(KEY(p), key);
  } catch (e) {}
}
function renderSetup() {
  const s = settings(), prov = AI.PROVIDERS[s.provider], model = modelOf(s);
  $('aiProvider').value = s.provider;
  const custom = !prov.models.includes(model);
  $('aiModel').innerHTML = prov.models.map(m => `<option value="${m}">${esc(m)}${m === prov.defaultModel ? esc(T.recommended) : ''}</option>`).join('')
    + `<option value="__custom">${esc(T.otherModel)}</option>`;
  $('aiModel').value = custom ? '__custom' : model;
  $('aiModelCustomRow').hidden = !custom;
  $('aiModelCustom').value = custom ? model : '';
  $('aiKey').value = getKey(s.provider);
  $('aiRemember').checked = !!s.remember;
  $('aiKeyLink').href = prov.keyUrl;
  $('aiPrice').textContent = priceNote(s.provider, model);
  const hasKey = !!getKey(s.provider);
  $('aiSetupNote').textContent = hasKey ? fill(T.setupReady, { p: prov.label, m: model }) : T.setupNeedKey;
  if (renderSetup.last !== s.provider + model) { renderSetup.last = s.provider + model; checkJob++; $('aiKeyStatus').className = 'ai-key-status muted'; $('aiKeyStatus').textContent = ''; }
  if (!hasKey) $('aiSetup').open = true;
}
/* ---------------- key check ---------------- */
let checkJob = 0;
async function checkKey(auto) {
  const s = settings(), key = getKey(s.provider), el = $('aiKeyStatus'), job = ++checkJob;
  const show = (cls, text) => { if (job !== checkJob) return; el.className = 'ai-key-status ' + cls; el.textContent = text; };
  if (!key) { show('muted', auto ? '' : T.err.no_key); return; }
  const shapeOk = AI.keyLooksRight(s.provider, key);
  show('muted', T.keyChecking);
  try {
    const r = await AI.checkKey({ provider: s.provider, model: modelOf(s), apiKey: key });
    show('ok', fill(T.keyOk, { m: r.model }) + (shapeOk ? '' : T.keyOddShape));
  } catch (e) {
    const code = (e && e.code) || 'unknown';
    show('bad', (code === 'model' ? fill(T.keyNoModel, { m: modelOf(s) }) : T.err[code] || T.err.unknown) + (shapeOk ? '' : T.keyOddShape));
  }
}
function priceNote(p, m) {
  const r = AI.PROVIDERS[p].price[m];
  return r ? fill(T.priceNote, { i: r[0], o: r[1] }) : '';
}

/* ---------------- running a request ---------------- */
async function run(kind, build, handle) {
  if (st.ctl) return;
  if (api().isBusy()) { showError({ code: 'busy' }); return; }
  const s = settings(), key = getKey(s.provider);
  if (!key) { $('aiSetup').open = true; $('aiKey').focus(); showError({ code: 'no_key' }); return; }
  let req;
  try { req = build(); } catch (e) { showError({ code: 'input', message: e.message }); return; }
  const asked = P().lyrics;                              // answers refer to these lines; they must not change meanwhile
  st.ctl = new AbortController();
  const signal = st.ctl.signal;
  $('aiResult').innerHTML = '';
  try {
    let media = null;
    if (req.audio) {                                     // 曲を使う: the song's audio goes with the request (Gemini only)
      if (s.provider !== 'gemini') throw new AI.AIError('no_audio');
      const buf = J.ui.audio && J.ui.audio.buffer;
      if (!buf) throw new AI.AIError('no_song');
      setBusy(true, T.preparingAudio);
      await new Promise(r => setTimeout(r, 30));         // let the status show before encoding
      const audio = AI.audioFromBuffer(buf);
      media = [await AI.audioPart({ audio, apiKey: key, signal, onStage: x => setBusy(true, x === 'upload' ? T.uploading : T.processing) })];
    }
    setBusy(true, fill(T.asking, { p: AI.PROVIDERS[s.provider].label, m: modelOf(s) }));
    const res = await AI.call({ provider: s.provider, model: modelOf(s), apiKey: key, system: req.system, prompt: req.prompt, schema: req.schema, effort: req.effort, signal, media });
    showCost(s, res);
    if (P().lyrics !== asked) throw new AI.AIError('stale');
    handle(res.json, asked);
    reveal();
  } catch (e) {
    showError(e);
  } finally {
    st.ctl = null; setBusy(false); updateAudio();
  }
}
function setBusy(on, text) {
  document.querySelectorAll('.ai-go').forEach(b => { b.disabled = on; });
  $('aiStatus').hidden = !on;
  clearInterval(st.timer);
  if (on) {
    const t0 = Date.now();
    const tick = () => { $('aiStatusText').textContent = text + fill(T.elapsed, { s: Math.round((Date.now() - t0) / 1000) }); };
    tick(); st.timer = setInterval(tick, 1000);
  }
}
function showCost(s, res) {
  const usd = AI.costUSD(s.provider, res.model || modelOf(s), res.usage);
  $('aiCost').textContent = fill(T.cost, { i: res.usage.input, o: res.usage.output }) + (usd != null ? fill(T.costMoney, { usd: usd < 0.01 ? usd.toFixed(4) : usd.toFixed(3), jpy: Math.max(0.1, usd * USD_JPY).toFixed(1) }) : '');
}
function reveal() { const r = $('aiResult'); if (r.firstElementChild) r.firstElementChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
function showError(e) {
  const code = (e && e.code) || 'unknown';
  const msg = T.err[code] || T.err.unknown;
  const detail = e && e.message && e.message !== code && code !== 'aborted' ? `<p class="ai-warn">${esc(String(e.message).slice(0, 200))}</p>` : '';
  $('aiResult').innerHTML = `<div class="ai-box err"><h4>${esc(msg)}</h4>${detail}</div>`;
  reveal();
}

/* ---------------- applying (always undoable) ---------------- */
/* an answer is about the lyric lines it was asked with: refuse to apply it once they have changed */
function stillFresh(asked) {
  if (P().lyrics === asked) return true;
  api().toast(T.staleApply); return false;
}
/* map: old line number -> new, when the apply removed lines (the ◀ ▶ history is renumbered to match) */
function applyProject(next, msg, map) {
  if (api().isBusy()) { api().toast(T.err.busy); return false; }
  const before = JSON.stringify(J.ui.project);
  api().remember();
  if (map) api().remapLines(map);
  replaceProject(next);
  api().commit();
  const after = JSON.stringify(J.ui.project);
  st.undo.push({ before, after, map: map || null }); if (st.undo.length > 30) st.undo.shift();
  st.lastApplied = after;
  $('aiUndo').disabled = false;
  api().toast(msg);
  api().restartPreview();
  return true;
}
function replaceProject(next) {
  const cur = J.ui.project;
  for (const k of Object.keys(cur)) if (!(k in next)) delete cur[k];
  Object.assign(cur, JSON.parse(JSON.stringify(next)));
  api().refresh();
}
function undo() {
  const top = st.undo[st.undo.length - 1]; if (!top) return;
  if (api().isBusy()) { api().toast(T.err.busy); return; }
  // undo brings back the whole project from before the AI change: ask first if it was edited since
  if (JSON.stringify(J.ui.project) !== top.after && !window.confirm(T.undoConfirm)) return;
  st.undo.pop();
  api().remember();
  if (top.map) api().remapLines(Object.fromEntries(Object.entries(top.map).map(([a, b]) => [b, +a])));
  replaceProject(JSON.parse(top.before));
  api().commit();
  st.lastApplied = null;
  document.querySelectorAll('.ai-box.applied').forEach(b => b.classList.remove('applied'));
  $('aiUndo').disabled = !st.undo.length;
  api().toast(T.undone);
}

/* ---------------- describing changes ---------------- */
const FX_LABEL = { motion: '動きの強さ', glitch: 'グリッチ', chroma: '色ズレ', decor: '装飾の量', density: 'カットの細かさ', texture: '質感', bgSwitch: '背景の切替' };
const FIELD_LABEL = { layout: 'レイアウト', enter: '登場', exit: '退場', hold: '保持' };
const GROUP_REG = g => J.registry(g) || {};
const partName = ref => { const [g, k] = ref.split('.'); return (GROUP_REG(g)[k] || {}).name || k; };
const seasonName = s => (s === 'any' || !s ? T.seasonAny : (J.SEASON_NAME || {})[s] || s);
const lineText = i => { const l = J.ui.plan && J.ui.plan.lines[i]; return l ? l.text : ''; };
const lineLabel = i => fill(T.line, { n: i + 1, text: esc(lineText(i).slice(0, 18)) });
const swatch = cols => `<span class="swatches">${cols.map(c => `<i style="background:${esc(c)}" title="${esc(c)}"></i>`).join('')}</span>`;
const pct = v => Math.round(v * 100);
function describe(c) {
  switch (c.kind) {
    case 'season': return fill(T.chSeason, { from: esc(seasonName(c.from)), to: esc(seasonName(c.to)) }) + `<span class="why">${esc(c.to === 'none' ? T.seasonNoneWhy : c.to === 'any' ? '' : T.seasonWhy)}</span>`;
    case 'style': return fill(T.chStyle, { from: esc(J.STYLES[c.from] ? J.STYLES[c.from].name : c.from), to: esc(J.STYLES[c.to].name) });
    case 'mood': return fill(T.chMood, { from: esc(c.from && J.MOODS[c.from] ? J.MOODS[c.from].name : T.custom), to: esc(J.MOODS[c.to].name) }) + `<span class="why">${esc(T.moodWhy)}</span>`;
    case 'fx': return fill(T.chFx, { label: esc(FX_LABEL[c.key] || c.key), from: pct(c.from), to: pct(c.to) });
    case 'flash': return c.to ? T.chFlashOn : T.chFlashOff;
    case 'palette': return fill(T.chPalette, { from: c.from ? swatch([c.from.accent, c.from.ghostA, c.from.ghostB]) : esc(T.styleColors), to: swatch([c.to.accent, c.to.ghostA, c.to.ghostB]) });
    case 'avoid': return fill(T.chAvoid, { n: c.parts.length }) + `<span class="why">${esc(c.parts.map(partName).join('・'))}</span>`;
    case 'allow': return fill(T.chAllow, { n: c.parts.length }) + `<span class="why">${esc(c.parts.map(partName).join('・'))}</span>`;
    case 'line': return fill(T.chLine, { line: lineLabel(c.i), field: esc(FIELD_LABEL[c.field]), from: esc(c.from ? partName(c.field + '.' + c.from) : T.auto), to: esc(partName(c.field + '.' + c.to)) });
    case 'impact': return fill(c.to ? T.chImpactOn : T.chImpactOff, { line: lineLabel(c.i) }) + repeats(c);
    case 'emphasis': return fill(T.chEmph, { line: lineLabel(c.i), word: esc(c.word) }) + repeats(c);
    default: return esc(c.kind);
  }
}
const repeats = c => (c.repeats > 1 ? `<span class="why">${esc(fill(T.repeats, { n: c.repeats }))}</span>` : '');
function changeList(changes, checkable, name) {
  return `<ul class="ai-changes">${changes.map((c, i) => checkable
    ? `<li><input type="checkbox" checked data-i="${i}" id="${name}_${i}"><label for="${name}_${i}">${describe(c)}</label></li>`
    : `<li class="nocheck"><span>${describe(c)}</span></li>`).join('')}</ul>`;
}
const picked = (box, list) => [...box.querySelectorAll('.ai-changes input[type=checkbox]')].filter(x => x.checked).map(x => list[+x.dataset.i]);
const warnings = w => (w && w.length ? `<p class="ai-warn">${esc(fill(T.dropped, { n: w.length }))}</p>` : '');

/* ---------------- 1) 歌詞の下ごしらえ ---------------- */
function prep() {
  run('prep', () => {
    const q = AI.prepRequest(P(), UI_LANG);
    if (!q.lines.length) throw new Error(T.noLyrics);
    return q;
  }, (json, asked) => {
    const r = AI.prepChanges(P(), json);
    const box = document.createElement('div'); box.className = 'ai-box';
    if (!r.changes.length) { box.innerHTML = `<h4>${esc(T.prepNone)}</h4>${json.summary ? `<p>${esc(json.summary)}</p>` : ''}${warnings(r.warnings)}`; $('aiResult').replaceChildren(box); return; }
    box.innerHTML = `<h4>${esc(fill(T.prepTitle, { n: r.changes.length }))}</h4>${json.summary ? `<p>${esc(json.summary)}</p>` : ''}
      <ul class="ai-changes">${r.changes.map((c, i) => `<li><input type="checkbox" checked data-i="${i}" id="aiPrep_${i}"><label for="aiPrep_${i}">
        <span class="from">${esc(c.before.trim())}</span><br>${c.remove ? `<span class="to">${esc(T.prepRemove)}</span>` : `<span class="to">${esc(c.after)}</span>`}
        ${c.reason ? `<span class="why">${esc(c.reason)}</span>` : ''}</label></li>`).join('')}</ul>${warnings(r.warnings)}
      <div class="ai-actions"><button class="primary" data-a="apply">${esc(T.prepApply)}</button><button class="ghost small" data-a="all">${esc(T.all)}</button><button class="ghost small" data-a="none">${esc(T.none)}</button><button class="ghost small" data-a="close">${esc(T.dismiss)}</button></div>`;
    box.addEventListener('click', e => {
      const a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (a === 'all' || a === 'none') box.querySelectorAll('input[type=checkbox]').forEach(x => { x.checked = a === 'all'; });
      if (a === 'close') box.remove();
      if (a === 'apply') {
        if (!stillFresh(asked)) return;
        const chosen = picked(box, r.changes); if (!chosen.length) return;
        const patch = AI.applyPrep(P(), chosen);
        const next = Object.assign(JSON.parse(JSON.stringify(P())), { lyrics: patch.lyrics, overrides: patch.overrides, timing: patch.timing });
        if (!applyProject(next, fill(T.prepDone, { n: chosen.length }), patch.map)) return;
        box.classList.add('applied'); box.querySelector('[data-a=apply]').disabled = true;
      }
    });
    $('aiResult').replaceChildren(box);
  });
}

/* the project as the look prompts see it: the song analysis only while that song is loaded */
function withSong() {
  const p = P(), a = J.ui.audio;
  if (!p.songInfo || (a && p.songInfo.name === a.name)) return p;
  return Object.assign({}, p, { songInfo: null });
}

/* ---------------- 2) AI 演出3案 ---------------- */
function propose() {
  run('propose', () => {
    if (!J.ui.plan.lines.length) throw new Error(T.noLyrics);
    return AI.proposalsRequest(withSong(), J.ui.plan, UI_LANG);
  }, (json, asked) => {
    const r = AI.proposalChanges(P(), J.ui.plan, json);
    st.proposals = { base: JSON.stringify(P()), list: r.proposals, appliedAfter: null };
    const head = document.createElement('div'); head.className = 'ai-box';
    head.innerHTML = `<h4>${esc(fill(T.propTitle, { season: seasonName(r.season) }))}</h4>${r.theme ? `<p>${esc(r.theme)}</p>` : ''}${warnings(r.warnings)}`;
    const boxes = r.proposals.map((p, k) => {
      const box = document.createElement('div'); box.className = 'ai-box';
      box.innerHTML = `<h4>${esc(fill(T.propCard, { n: k + 1, title: p.title }))}</h4>${p.concept ? `<p>${esc(p.concept)}</p>` : ''}
        ${p.changes.length ? changeList(p.changes, false) : `<p class="ai-warn">${esc(T.propEmpty)}</p>`}
        <div class="ai-actions"><button class="primary" data-k="${k}" ${p.changes.length ? '' : 'disabled'}>${esc(T.propApply)}</button></div>`;
      return box;
    });
    $('aiResult').replaceChildren(head, ...boxes);
    const props = st.proposals;
    boxes.forEach((box, k) => box.querySelector('button[data-k]').addEventListener('click', () => {
      if (!stillFresh(asked)) return;
      // switching straight from one proposal to another starts again from the look before the first one;
      // after any other change, the current project becomes the new starting point
      if (props.appliedAfter !== JSON.stringify(P())) props.base = JSON.stringify(P());
      const next = AI.applyChanges(JSON.parse(props.base), r.proposals[k].changes);
      if (!applyProject(next, fill(T.propDone, { title: r.proposals[k].title || k + 1 }))) return;
      props.appliedAfter = st.lastApplied;
      boxes.forEach(b => b.classList.toggle('applied', b === box));
    }));
  });
}

/* ---------------- 3) ひとこと修正 ---------------- */
function edit() {
  const text = $('aiEditText').value.trim();
  if (!text) { $('aiEditText').focus(); return; }
  run('edit', () => AI.editRequest(withSong(), J.ui.plan, text, UI_LANG), (json, asked) => {
    const r = AI.editChanges(P(), J.ui.plan, json);
    const box = document.createElement('div'); box.className = 'ai-box';
    if (!r.understood || !r.changes.length) {
      box.innerHTML = `<h4>${esc(r.understood ? T.editNone : T.editUnclear)}</h4>${r.question ? `<p>${esc(r.question)}</p>` : r.summary ? `<p>${esc(r.summary)}</p>` : ''}${warnings(r.warnings)}`;
      $('aiResult').replaceChildren(box); return;
    }
    box.innerHTML = `<h4>${esc(fill(T.editTitle, { text }))}</h4>${r.summary ? `<p>${esc(r.summary)}</p>` : ''}${changeList(r.changes, true, 'aiEd')}${warnings(r.warnings)}
      <div class="ai-actions"><button class="primary" data-a="apply">${esc(T.editApply)}</button><button class="ghost small" data-a="close">${esc(T.dismiss)}</button></div>`;
    box.addEventListener('click', e => {
      const a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (a === 'close') box.remove();
      if (a === 'apply') {
        if (!stillFresh(asked)) return;
        const chosen = picked(box, r.changes); if (!chosen.length) return;
        if (!applyProject(AI.applyChanges(P(), chosen), fill(T.editDone, { n: chosen.length }))) return;
        box.classList.add('applied'); box.querySelector('[data-a=apply]').disabled = true;
      }
    });
    $('aiResult').replaceChildren(box);
  });
}

/* ---------------- 4) 曲を使う (Gemini only) ---------------- */
const fmt = t => J.fmtTime(t);
function updateAudio() {
  const s = settings(), song = J.ui.audio && J.ui.audio.buffer;
  const why = s.provider !== 'gemini' ? T.audioNeedGemini : !song ? T.audioNeedSong : !s.audioOk ? T.audioNeedOk : '';
  $('aiAudioOk').checked = !!s.audioOk;
  document.querySelectorAll('.ai-audio-go').forEach(b => { b.disabled = !!why || !!st.ctl; });
  $('aiAudioNote').textContent = why;
  const info = P() && P().songInfo;
  $('aiSongNote').hidden = !(info && J.ui.audio && info.name === J.ui.audio.name);
}
function transcribe() {
  run('transcribe', () => Object.assign(AI.transcribeRequest(UI_LANG), { audio: true }), (json, asked) => {
    const r = AI.transcriptLines(json, J.ui.audio && J.ui.audio.duration);
    const box = document.createElement('div'); box.className = 'ai-box';
    if (!r.lines.length) { box.innerHTML = `<h4>${esc(T.trNone)}</h4>${r.note ? `<p>${esc(r.note)}</p>` : ''}`; $('aiResult').replaceChildren(box); return; }
    box.innerHTML = `<h4>${esc(fill(T.trTitle, { n: r.lines.length }))}</h4>${r.note ? `<p>${esc(r.note)}</p>` : ''}
      <ul class="ai-lines">${r.lines.map(l => `<li><span class="mono">${fmt(l.start)}</span><span>${esc(l.text)}</span></li>`).join('')}</ul>
      <label class="check"><input type="checkbox" checked data-times><span>${esc(T.trTimes)}<small>${esc(T.trTimesWhy)}</small></span></label>${warnings(r.warnings)}
      <p class="ai-warn">${esc(T.trReplace)}</p>
      <div class="ai-actions"><button class="primary" data-a="apply">${esc(T.trApply)}</button><button class="ghost small" data-a="close">${esc(T.dismiss)}</button></div>`;
    box.addEventListener('click', e => {
      const a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (a === 'close') box.remove();
      if (a === 'apply') {
        if (!stillFresh(asked)) return;
        const next = JSON.parse(JSON.stringify(P()));
        next.lyrics = AI.transcriptLyrics(r.lines, box.querySelector('[data-times]').checked);
        next.overrides = {};                                         // per-line settings belonged to the old lines
        next.timing = Object.assign({}, next.timing, { lineTimes: {} });
        if (!applyProject(next, fill(T.trDone, { n: r.lines.length }), {})) return;
        box.classList.add('applied'); box.querySelector('[data-a=apply]').disabled = true;
      }
    });
    $('aiResult').replaceChildren(box);
  });
}
function align() {
  run('align', () => {
    if (!J.ui.plan.lines.length) throw new Error(T.noLyrics);
    if (AI.hasLrc(P())) throw new Error(T.alignHasLrc);
    return Object.assign(AI.alignRequest(P(), J.ui.plan, UI_LANG), { audio: true });
  }, (json, asked) => {
    const r = AI.alignChanges(P(), J.ui.plan, json, J.ui.audio && J.ui.audio.duration);
    const box = document.createElement('div'); box.className = 'ai-box';
    if (!r.changes.length) { box.innerHTML = `<h4>${esc(T.alNone)}</h4>${r.note ? `<p>${esc(r.note)}</p>` : ''}${warnings(r.warnings)}`; $('aiResult').replaceChildren(box); return; }
    box.innerHTML = `<h4>${esc(fill(T.alTitle, { n: r.changes.length }))}</h4>${r.note ? `<p>${esc(r.note)}</p>` : ''}
      <ul class="ai-changes">${r.changes.map((c, i) => `<li><input type="checkbox" checked data-i="${i}" id="aiAl_${i}"><label for="aiAl_${i}">${fill(T.alLine, { line: lineLabel(c.i), from: fmt(c.from), to: fmt(c.to) })}</label></li>`).join('')}</ul>${warnings(r.warnings)}
      <div class="ai-actions"><button class="primary" data-a="apply">${esc(T.alApply)}</button><button class="ghost small" data-a="all">${esc(T.all)}</button><button class="ghost small" data-a="none">${esc(T.none)}</button><button class="ghost small" data-a="close">${esc(T.dismiss)}</button></div>`;
    box.addEventListener('click', e => {
      const a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (a === 'all' || a === 'none') box.querySelectorAll('input[type=checkbox]').forEach(x => { x.checked = a === 'all'; });
      if (a === 'close') box.remove();
      if (a === 'apply') {
        if (!stillFresh(asked)) return;
        const chosen = picked(box, r.changes); if (!chosen.length) return;
        if (!applyProject(AI.applyTimes(P(), chosen), fill(T.alDone, { n: chosen.length }))) return;
        box.classList.add('applied'); box.querySelector('[data-a=apply]').disabled = true;
      }
    });
    $('aiResult').replaceChildren(box);
  });
}
function analyze() {
  run('analyze', () => Object.assign(AI.analyzeRequest(UI_LANG), { audio: true }), json => {
    const info = Object.assign(AI.songInfo(json, J.ui.audio && J.ui.audio.duration), { name: J.ui.audio && J.ui.audio.name });
    J.ui.project.songInfo = info; api().flushSave();             // kept with the project; the look prompts use it
    const box = document.createElement('div'); box.className = 'ai-box';
    const lineRange = sec => { const ls = J.ui.plan.lines.filter(l => l.start >= sec.start - 0.3 && l.start < sec.end); return ls.length ? fill(T.anLines, { a: ls[0].index + 1, b: ls[ls.length - 1].index + 1 }) : ''; };
    box.innerHTML = `<h4>${esc(T.anTitle)}</h4>${info.summary ? `<p>${esc(info.summary)}</p>` : ''}
      <p>${esc(fill(T.anMood, { mood: info.mood || '—', bpm: info.bpm || '—' }))}</p>
      <ul class="ai-lines">${info.sections.map(sec => `<li><span class="mono">${fmt(sec.start)}</span><span>${esc(T.sec[sec.kind] || sec.kind)}${esc(fill(T.anUntil, { t: fmt(sec.end) }))}${esc(lineRange(sec))}</span></li>`).join('')}</ul>
      ${info.highlights.length ? `<ul class="ai-lines">${info.highlights.map(h => `<li><span class="mono">${fmt(h.time)}</span><span>${esc(h.what)}</span></li>`).join('')}</ul>` : ''}
      <p class="ai-warn">${esc(T.anSaved)}</p>
      <div class="ai-actions"><button class="primary" data-a="propose">${esc(T.anPropose)}</button><button class="ghost small" data-a="close">${esc(T.dismiss)}</button></div>`;
    box.addEventListener('click', e => {
      const a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (a === 'close') box.remove();
      if (a === 'propose') propose();
    });
    $('aiResult').replaceChildren(box);
    updateAudio();
  });
}

/* ---------------- panel ---------------- */
function open() {
  const p = $('aiPanel'); p.hidden = false; $('app').classList.add('ai-open'); $('aiOpen').setAttribute('aria-expanded', 'true');
  renderSetup(); updateAudio();
  (getKey(settings().provider) ? $('aiPrep') : $('aiKey')).focus();
}
function close() { $('aiPanel').hidden = true; $('app').classList.remove('ai-open'); $('aiOpen').setAttribute('aria-expanded', 'false'); $('aiOpen').focus(); }
function init() {
  $('aiOpen').addEventListener('click', () => ($('aiPanel').hidden ? open() : close()));
  $('aiOpenEasy').addEventListener('click', open);
  $('aiClose').addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.code === 'Escape' && !$('aiPanel').hidden && !$('termsDlg').open) { if (st.ctl) st.ctl.abort(); else close(); } });
  $('aiProvider').addEventListener('change', e => { const s = settings(); s.provider = e.target.value; saveSettings(s); renderSetup(); updateAudio(); });
  $('aiAudioOk').addEventListener('change', e => { const s = settings(); s.audioOk = e.target.checked; saveSettings(s); updateAudio(); });
  $('aiTranscribe').addEventListener('click', transcribe);
  $('aiAlign').addEventListener('click', align);
  $('aiAnalyze').addEventListener('click', analyze);
  // the song line changes when a song is loaded (or fails to): refresh the audio buttons
  if (window.MutationObserver) new MutationObserver(() => { if (!$('aiPanel').hidden) updateAudio(); }).observe($('audioName'), { childList: true, characterData: true, subtree: true });
  $('aiModel').addEventListener('change', e => {
    const s = settings();
    if (e.target.value === '__custom') { $('aiModelCustomRow').hidden = false; $('aiModelCustom').focus(); return; }
    s.models[s.provider] = e.target.value; saveSettings(s); renderSetup();
  });
  $('aiModelCustom').addEventListener('change', e => { const s = settings(); const v = e.target.value.trim(); if (v) s.models[s.provider] = v; else delete s.models[s.provider]; saveSettings(s); renderSetup(); });
  $('aiKey').addEventListener('change', e => { const s = settings(); setKey(s.provider, e.target.value.replace(/\s+/g, ''), s.remember); renderSetup(); checkKey(true); });
  $('aiCheck').addEventListener('click', () => checkKey(false));
  $('aiRemember').addEventListener('change', e => { const s = settings(); s.remember = e.target.checked; saveSettings(s); for (const p of Object.keys(AI.PROVIDERS)) { const k = getKey(p); if (k) setKey(p, k, s.remember); } });
  $('aiForget').addEventListener('click', () => { for (const p of Object.keys(AI.PROVIDERS)) setKey(p, '', false); renderSetup(); api().toast(T.forgot); });
  $('aiPrep').addEventListener('click', prep);
  $('aiPropose').addEventListener('click', propose);
  $('aiEditForm').addEventListener('submit', e => { e.preventDefault(); edit(); });
  $('aiCancel').addEventListener('click', () => { if (st.ctl) st.ctl.abort(); });
  $('aiUndo').addEventListener('click', undo);
}

/* ---------------- words on screen ---------------- */
const T = {
  recommended: '（既定）', otherModel: 'その他（モデル ID を入力）', priceNote: '料金の目安：100万トークンあたり 入力 ${i}・出力 ${o}',
  setupReady: '{p}・{m}', setupNeedKey: 'API キーが未設定です',
  asking: '{p}（{m}）に問い合わせ中', elapsed: '…{s}秒',
  cost: '入力 {i}・出力 {o} トークン', costMoney: '（約 ${usd} ≒ {jpy}円）',
  noLyrics: '歌詞が空です。',
  line: '{n}行目「{text}」', auto: '自動', custom: 'カスタム', styleColors: 'スタイルの色', seasonAny: '指定なし',
  seasonWhy: 'ほかの季節のモチーフ（雪・桜・花火など）は自動では使いません', seasonNoneWhy: '季節のモチーフ（雪・桜・花火など）は自動では使いません',
  moodWhy: '使う手法も雰囲気に合わせて絞ります',
  chSeason: '季節：{from} → {to}', chStyle: 'スタイル：{from} → {to}', chMood: '雰囲気：{from} → {to}',
  chFx: '{label}：{from} → {to}', chFlashOn: 'フラッシュ：オンにする', chFlashOff: 'フラッシュ：オフにする',
  chPalette: '配色：{from} → {to}', chAvoid: '使わない手法を {n} 個に設定', chAllow: '使う手法に {n} 個戻す',
  chLine: '{line} の{field}：{from} → {to}', chImpactOn: '{line}：フラッシュと揺れを入れる', chImpactOff: '{line}：フラッシュと揺れを外す',
  chEmph: '{line}：「{word}」を強調',
  dropped: '一覧にない手法や、季節に合わない指定など {n} 件は使いませんでした。',
  all: 'すべて選ぶ', none: 'すべて外す', dismiss: '閉じる',
  prepTitle: '下ごしらえの案（{n} 件）', prepNone: '直したほうがよい行は見つかりませんでした。', prepRemove: '→ この行を除く',
  prepApply: '選んだ変更を歌詞に反映', prepDone: '歌詞の下ごしらえ：{n} 件を反映しました',
  propTitle: '演出の3案（季節：{season}）', propCard: '案{n}　{title}', propEmpty: '使える変更がありませんでした。',
  propApply: 'この案にする', propDone: '演出の案「{title}」にしました',
  editTitle: '「{text}」の変更案', editNone: '変えるところが見つかりませんでした。', editUnclear: '指示の意味を確かめさせてください',
  editApply: '選んだ変更を適用', editDone: 'ひとこと修正：{n} 件を適用しました',
  keyChecking: 'キーを確かめています…', keyOk: 'このキーで使えます（{m}）', keyNoModel: 'キーは有効ですが、{m} は使えません。モデルを変えてください',
  keyOddShape: '（キーの形式がいつもと違います。貼り付けまちがいがないか見てください）',
  preparingAudio: '曲の音声を準備中', uploading: '曲をアップロード中', processing: 'アップロードした曲の準備を待っています',
  audioNeedGemini: 'AI サービスで Google Gemini を選んだときだけ使えます。', audioNeedSong: '先に「曲を読み込む」で曲を読み込んでください。',
  audioNeedOk: '使うには、上の同意にチェックを入れてください。',
  trTitle: '書き起こした歌詞（{n} 行）', trNone: '歌詞を聞き取れませんでした。', trTimes: '行ごとの時刻も入れる',
  trTimesWhy: '歌詞の行頭に [分:秒] の時刻が付き、その時刻で表示されます', trReplace: 'いまの歌詞は、この歌詞に置き換わります（元に戻せます）。',
  trApply: 'この歌詞にする', trDone: '書き起こした歌詞（{n} 行）にしました',
  alignHasLrc: '歌詞に [分:秒] の時刻が付いているため、タイミング合わせは使えません。時刻を消してから試してください。',
  alTitle: 'タイミングの案（{n} 行）', alNone: '時刻を変える行はありませんでした。', alLine: '{line}：{from} → {to}',
  alApply: '選んだ行の時刻を反映', alDone: '{n} 行の開始時刻を合わせました',
  anTitle: '曲の分析', anUntil: '（〜{t}）', anMood: '雰囲気：{mood}　テンポ：{bpm} BPM', anLines: '　{a}〜{b}行目',
  anSaved: 'この分析はプロジェクトに保存し、演出3案とひとこと修正で使います。', anPropose: 'この分析で演出3案を作る',
  sec: { intro: 'イントロ', verse: 'Aメロ', prechorus: 'Bメロ', chorus: 'サビ', bridge: 'Cメロ', interlude: '間奏', solo: 'ソロ', outro: 'アウトロ', other: 'その他' },
  staleApply: '案を作ったあとに歌詞が変わったため、反映できません。もう一度作ってください',
  repeats: '同じ行の繰り返し（{n} か所）すべてに入ります',
  undoConfirm: 'AI の変更のあとに変えたところも、AI の変更の前の状態に戻ります。元に戻しますか？',
  undone: 'AI の変更を元に戻しました', forgot: 'API キーを消しました',
  err: {
    no_key: 'API キーを入れてください。', busy: '書き出し中やタップ同期中は使えません。', input: '送る内容を作れませんでした。',
    auth: 'API キーが正しくないか、使えない状態です。キーを確かめてください。',
    rate: '利用の上限に達しました。少し待ってから、もう一度試してください。',
    model: 'このモデルは使えません。モデルを変えてください。',
    network: 'AI サービスにつながりませんでした。ネットワークを確かめてください。',
    server: 'AI サービス側でエラーが起きました。少し待ってから、もう一度試してください。',
    blocked: 'AI サービスが、この内容への回答を控えました。',
    truncated: '回答が長すぎて、途中で切れました。もう一度試してください。',
    bad_json: '回答を読み取れませんでした。もう一度試してください。',
    empty: '回答が空でした。もう一度試してください。',
    bad_request: 'リクエストが受け付けられませんでした。',
    no_sdk: 'Claude 用の部品を読み込めませんでした。',
    bad_provider: 'この AI サービスには対応していません。',
    stale: '問い合わせのあいだに歌詞が変わりました。もう一度試してください。',
    no_audio: '曲を使う機能は、Google Gemini を選んだときだけ使えます。', no_song: '先に曲を読み込んでください。',
    upload: '曲をアップロードできませんでした。少し待ってから、もう一度試してください。',
    bad_edit: '歌詞を書き換えられませんでした。',
    aborted: '中止しました。', unknown: 'うまくいきませんでした。もう一度試してください。',
  },
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
