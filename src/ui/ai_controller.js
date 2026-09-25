/* 文字PVメーカー v2 — original work. AI controller: keys in session/local storage, key check, runs with stages and abort, audio consent, reviews, apply and selective revert; the area instructions and materials (DESIGN §4.22, §6.4.10; DESIGN_2_1 §5.2–§5.6, §6.2–§6.4). */
MV.def('ui/ai_controller', ['ai/providers', 'ai/prep', 'ai/looks', 'ai/song', 'ai/changes', 'i18n/t', 'ui/looks', 'ui/selection',
  'planner/areas'],
  (PR, PREP, LOOKS, SONG, CH, T, LK, S, AREAS) => {
    'use strict';

    // v2.1: 'direct' (指示: area instructions, one brief from the panel, up to 8 from the board, or camera mode),
    // 'material' (素材づくり) and 'vision' (写真の説明, DESIGN_2_1 §11.6.2). Their request builders and validators are
    // ai/direct, ai/recipe and ai/vision, injected (deps.direct, deps.recipe, deps.vision) so the Node tests can fake the
    // answers.
    const TOOLS = Object.freeze(['prep', 'looks', 'edit', 'transcribe', 'align', 'analyze', 'direct', 'material', 'vision']);
    const SONG_TOOLS = Object.freeze(['transcribe', 'align', 'analyze']);
    // 歌詞 / 全体 / 行ごと / 時間 (§6.4.10.5), then the groups of area instructions (DESIGN_2_1 §5.6; the last four of
    // ai/changes GROUPS): 素材 / 区画 / カット / 区画の外.
    const AREA_GROUP_ORDER = Object.freeze(['materials', 'area', 'cuts', 'outside']);   // headings ai.grp.*
    const GROUP_ORDER = Object.freeze(['lyrics', 'work', 'lines', 'time'].concat(AREA_GROUP_ORDER));
    // The review of an area instruction (DESIGN_2_1 §6.4): 素材, then one 区画 group per area, カット, and the rest;
    // 区画の外 last (unchecked by default).
    const DIRECT_ORDER = Object.freeze(['materials', 'area', 'cuts', 'lyrics', 'lines', 'time', 'work', 'outside']);
    const MAX_BRIEFS = 8;                 // ai/direct.MAX_BRIEFS (§5.2)
    const ASK_MAX = 120;                  // a board draft (side.asks, §2.1)
    const ASKS_CAP = 40;
    // The running line (§6.4.10.4): 音声を準備中 → アップロード中 → 処理中 (Files API only, from ai/song) → 考え中.
    const STAGES = Object.freeze(['prepare', 'upload', 'process', 'think']);
    const GUIDE_TOPICS = Object.freeze(['prep', 'looks', 'direct', 'material', 'song', 'review', 'key']);   // AIでできること (ai.guide.*)
    const LYRIC_EDIT_KINDS = Object.freeze(['cut', 'note', 'emphasis', 'impact', 'remove']);
    const MAX_INSTRUCTION = 300;          // the ひとこと field (§6.4.10.3); ai/looks cuts the prompt at the same length
    const LOG_CAP = 50;                   // side.aiLog entries kept, like side.looks.cap, so autosaves stay small
    const LETTERS = Object.freeze(['A', 'B', 'C']);
    const KEY_PREFIX = Object.freeze({ gemini: 'AIza', claude: 'sk-ant-' });   // only for the shape hint
    const SETTINGS_KEY = 'mojipv.ai.settings';
    const WAV_HEADER = 44;

    // ---- storage (every access may throw: private mode, blocked storage) --------------------------------------------

    function safeGet(storage, name) {
      try { return storage ? storage.getItem(name) : null; } catch (e) { return null; }
    }
    function safeSet(storage, name, value) {
      try { if (storage) storage.setItem(name, value); } catch (e) { /* not kept; the value still works in memory */ }
    }
    function safeRemove(storage, name) {
      try { if (storage) storage.removeItem(name); } catch (e) { /* nothing to remove */ }
    }

    function providerOk(p) { return typeof p === 'string' && Object.prototype.hasOwnProperty.call(PR.PROVIDERS, p); }
    function modelOk(p, m) { return providerOk(p) && PR.PROVIDERS[p].models.includes(m); }

    // The chosen service, the model per service and the 「この端末に記憶する」 choice. None of it is secret, so it lives in
    // localStorage; unknown or broken values fall back to the defaults (Gemini, gemini-3.8-flash).
    function readSettings(local) {
      let saved = null;
      try { saved = JSON.parse(safeGet(local, SETTINGS_KEY) || 'null'); } catch (e) { saved = null; }
      const s = saved && typeof saved === 'object' ? saved : {};
      const models = {};
      for (const p of Object.keys(PR.PROVIDERS)) {
        const m = s.models && s.models[p];
        models[p] = modelOk(p, m) ? m : PR.PROVIDERS[p].defaultModel;
      }
      return { provider: providerOk(s.provider) ? s.provider : PR.DEFAULT_PROVIDER, models, remember: s.remember === true };
    }

    function writeSettings(local, settings) { safeSet(local, SETTINGS_KEY, JSON.stringify(settings)); }

    // API keys (§4.22.6): sessionStorage, gone with the tab, unless 「この端末に記憶する」 is on; then localStorage. A key is
    // only ever in one of the two. `ok` is the model the key was last confirmed for (so a working key shows 使えます at
    // once); it is not secret and sits next to the key.
    function createKeyStore(session, local) {
      const keyAt = (p) => 'mojipv.ai.key.' + p;
      const okAt = (p) => 'mojipv.ai.ok.' + p;
      function clear(provider) {
        for (const s of [session, local]) { safeRemove(s, keyAt(provider)); safeRemove(s, okAt(provider)); }
      }
      function clearAll() { for (const p of Object.keys(PR.PROVIDERS)) clear(p); }
      function load(provider) {
        const remembered = !!safeGet(local, keyAt(provider));
        const where = remembered ? local : session;
        const key = safeGet(where, keyAt(provider)) || '';
        return { key, remembered, ok: key ? safeGet(where, okAt(provider)) : null };
      }
      function save(provider, key, remember, ok) {
        if (!key) { clear(provider); return; }
        const keep = remember ? local : session;
        const drop = remember ? session : local;
        safeRemove(drop, keyAt(provider));
        safeRemove(drop, okAt(provider));
        safeSet(keep, keyAt(provider), key);
        if (ok) safeSet(keep, okAt(provider), ok); else safeRemove(keep, okAt(provider));
      }
      return { load, save, clear, clearAll };
    }

    // ---- pure helpers the panel and the tests share ------------------------------------------------------------------

    // The connection card's state (§6.4.10.1): unset 未設定 · shape 形が違うかも · set (a key not checked yet) · checking
    // 確認中… · ok 使えます · bad キーが違います · model このモデルは使えません · offline 通信できません.
    function keyStatus(provider, key, okModel, model) {
      if (!key) return 'unset';
      if (okModel && okModel === model) return 'ok';
      return PR.keyLooksRight(provider, key) ? 'set' : 'shape';
    }

    // An error code → the card's state, or null when the error says nothing about the key (rate limit, bad answer …).
    function statusOfError(code) {
      if (code === 'auth' || code === 'no_key') return 'bad';
      if (code === 'model') return 'model';
      if (code === 'network' || code === 'server' || code === 'no_sdk') return 'offline';
      return null;
    }

    function codeOf(e) {
      return e && typeof e.code === 'string' && PR.ERROR_CODES.includes(e.code) ? e.code : 'internal';
    }

    function fmtCount(n, lang) { return Math.round(Number(n) || 0).toLocaleString(lang === 'en' ? 'en-US' : 'ja-JP'); }

    // 「入力 3,210 / 出力 850 トークン · 約 $0.0042」: USD in both languages until a display rate is decided (§10.3).
    function costText(t, provider, model, usage) {
      if (!usage) return '';
      const p = { input: fmtCount(usage.input, t.lang), output: fmtCount(usage.output, t.lang) };
      const usd = PR.costUSD(provider, model, usage);
      return usd === null ? t('ai.review.costUnknown', p) : t('ai.review.cost', Object.assign(p, { cost: T.fmtMoney(usd, t.lang) }));
    }

    // What the consent card states before anything is encoded: the size of the WAV that ai/song will send (16-bit mono at
    // the rate it picks for this length, the same sample count as audio/wav.encodeWav), that rate in kHz (a long song
    // goes at 12 or 8 kHz) and the length as m:ss. buf: { length (frames), sampleRate, duration } (an AudioBuffer).
    function consentFacts(buf) {
      const secs = Math.max(0, Number(buf.duration) || 0);
      const rate = SONG.pickRate(secs);
      const frames = Math.floor((Number(buf.length) || 0) / ((Number(buf.sampleRate) || rate) / rate));
      const bytes = WAV_HEADER + Math.max(0, frames) * 2;
      return { mb: Math.round(bytes / (1024 * 1024) * 10) / 10, dur: T.fmtTime(secs).replace(/\.\d+$/, ''), rate,
        khz: Math.round(rate / 100) / 10 };
    }

    // The lines a ひとこと修正 can be limited to: the selected line(s) that exist in the plan.
    function selectedLines(sel, plan) {
      if (!plan || !Array.isArray(plan.lines)) return [];
      const known = new Set(plan.lines.map((l) => l.id));
      const s = S.validate(sel, plan);
      const ids = s.level === 'line' ? s.ids : [S.lineOfSel(s)].filter(Boolean);
      return ids.filter((id) => known.has(id));
    }

    // mediaOnDevice(doc, media) → the ids of the library's photos and videos whose bytes are on this device (media:
    // ui/media_io, or null before it is ready), or false when there are none: what 指示 and the board may offer when
    // 「写真・動画をAIが使ってよい」 is on (DESIGN_2_1 §11.6.1; the controller's state.allowMedia is the one switch).
    function mediaOnDevice(doc, media) {
      const list = doc && doc.media && Array.isArray(doc.media.list) ? doc.media.list : [];
      const here = list.filter((e) => !media || media.state(e.id) !== 'missing').map((e) => e.id);
      return here.length ? here : false;
    }

    function isChecked(c) { return c.checked !== false; }
    function letter(i) { return LETTERS[i] || String(i + 1); }

    function withChecked(changes, id, on) {
      return changes.map((c) => (c.id === id && isChecked(c) !== !!on ? Object.assign({}, c, { checked: !!on }) : c));
    }

    // [すべて] checks every row that is not stale (a stale row is re-checked one by one, on purpose); [なし] unchecks all.
    function withAll(changes, on) {
      return changes.map((c) => {
        const v = on ? (c.stale ? isChecked(c) : true) : false;
        return isChecked(c) === v ? c : Object.assign({}, c, { checked: v });
      });
    }

    // The review's rows grouped 歌詞 / 全体 / 行ごと / 時間, empty groups left out.
    function grouped(changes) {
      const out = GROUP_ORDER.map((group) => ({ group, changes: [] }));
      for (const c of changes) {
        const g = GROUP_ORDER.indexOf(CH.groupOf(c));
        out[g < 0 ? 1 : g].changes.push(c);
      }
      return out.filter((g) => g.changes.length);
    }

    function counts(changes) {
      let checked = 0, stale = 0;
      for (const c of changes) {
        if (isChecked(c)) checked++;
        if (c.stale) stale++;
      }
      return { total: changes.length, checked, stale };
    }

    function sameList(a, b) { return a.length === b.length && a.every((x, i) => x === b[i]); }

    // side.aiLog with one more entry, capped (oldest first out).
    function withLog(side, entry) {
      const list = (side && Array.isArray(side.aiLog) ? side.aiLog : []).concat([entry]);
      return Object.assign({}, side, { aiLog: list.length > LOG_CAP ? list.slice(list.length - LOG_CAP) : list });
    }

    // Whether [元に戻す] of a log entry still has something to do (the document still holds some of the AI's values).
    function revertable(doc, entry) { return CH.revertCommands(doc, entry).cmds.length > 0; }

    // A log item's target (the item shapes of ai/changes.logEntry).
    function itemKey(item) {
      if (item.material) return 'm:' + item.material;
      if (item.media) return 'a:' + item.media;
      if (item.path) return 'p:' + item.path;
      if (item.filter) return 'f:' + item.filter;
      if (item.rowId) return 'r:' + item.rowId;
      if (item.rows) return 'rows';
      if (item.songInfo) return 'song';
      return '';
    }

    // For each applied change, the indices of the log items it produced (`applied` from logEntry on the same doc). A
    // palette gives three items; the lyric changes of one row share that row's item (all of them share the whole-sheet
    // item when a row was removed). Stored as the entry's `groups` so [元に戻す] counts what the user accepted.
    function changeGroups(doc, plan, changes, applied) {
      const at = new Map(applied.map((item, i) => [itemKey(item), i]));
      const wholeSheet = at.has('rows');
      // new materials take the next ids in list order, as ai/changes.toCommands numbers them; a remade one keeps its id
      const next = doc.materials && Number.isInteger(doc.materials.next) ? doc.materials.next : 1;
      const fresh = changes.filter((c) => c.kind === 'material' && c.entry && !c.materialId);
      return changes.map((c) => {
        let keys;
        if (LYRIC_EDIT_KINDS.includes(c.kind)) keys = [wholeSheet ? 'rows' : 'r:' + c.rowId];
        else if ((c.kind === 'part' || c.kind === 'time' || c.kind === 'value') && c.path) keys = ['p:' + c.path];
        else if (c.kind === 'material' && c.entry) keys = ['m:' + (c.materialId || 'm' + (next + fresh.indexOf(c)).toString(36))];
        else keys = CH.logEntry(doc, CH.toCommands(doc, plan, [c]), {}).applied.map(itemKey);
        return [...new Set(keys)].filter((k) => at.has(k)).map((k) => at.get(k));
      });
    }

    function groupsOf(entry) {
      const g = entry.groups;
      const size = Array.isArray(entry.applied) ? entry.applied.length : 0;
      const ok = Array.isArray(g) && Number.isInteger(entry.n)
        && g.every((x) => Array.isArray(x) && x.every((i) => Number.isInteger(i) && i >= 0 && i < size));
      return ok ? g : null;
    }

    // What [元に戻す] reports, in the log's own unit (the changes applied, entry.n): a change counts as kept when anything
    // it produced was changed since (a palette whose accent was re-pinned; its other colours still go back).
    // keptItems: revertCommands(doc, entry).kept. An entry without valid groups (older autosaves) counts items.
    function revertTally(doc, entry, keptItems) {
      const groups = groupsOf(entry);
      if (!groups) return { n: Math.max(0, (entry.applied || []).length - keptItems), kept: keptItems };
      if (!keptItems) return { n: entry.n, kept: 0 };
      const isKept = entry.applied.map((item) => CH.revertCommands(doc, { applied: [item] }).kept > 0);
      const kept = groups.filter((x) => x.some((i) => isKept[i])).length;
      return { n: Math.max(0, entry.n - kept), kept };
    }

    function aiPinCount(doc) {
      let n = 0;
      for (const k of Object.keys(doc.pins)) if (doc.pins[k] && doc.pins[k].by === 'ai') n++;
      return n;
    }

    // The changes of a review: the list, or one proposal's (index ≥ 0) for 3案.
    function changesOf(review, index) {
      if (!review) return [];
      if (review.kind === 'looks') return (review.proposals[index] || { changes: [] }).changes;
      return review.changes || [];
    }

    function mapChanges(review, fn) {
      if (review.kind === 'looks') {
        let changed = false;
        const proposals = review.proposals.map((p) => {
          const next = fn(p.changes, p);
          if (sameList(next, p.changes)) return p;
          changed = true;
          return Object.assign({}, p, { changes: next });
        });
        return changed ? Object.assign({}, review, { proposals }) : review;
      }
      if (!review.changes) return review;
      const next = fn(review.changes, null);
      return sameList(next, review.changes) ? review : Object.assign({}, review, { changes: next });
    }

    // ---- area instructions: targets, groups, aggregates, dependencies, the board (DESIGN_2_1 §5.2, §6.2–§6.4) ----------

    // targetRef(target, sel, doc, plan) → the AreaRef the instruction box sends: 全体 → work; 選択中 → the named area with
    // exactly the selected lines (or those lines), or the selected cut; 区画 → the picked area. null when 選択中 has no
    // selection or the picked area is gone.
    function targetRef(target, sel, doc, plan) {
      const tg = target || { mode: 'work' };
      if (tg.mode === 'area') return tg.ref && plan && AREAS.resolve(doc, plan, tg.ref) ? tg.ref : null;
      if (tg.mode !== 'sel') return { kind: 'work' };
      if (!plan) return null;
      const s = S.validate(sel, plan, doc);
      if (s.level === 'cut' && !S.lineOfSel(s)) return { kind: 'cut', key: s.key };
      if (s.level === 'cut') {
        const line = plan.lines.find((l) => l.id === S.lineOfSel(s));
        if (line && line.cuts.length > 1) return { kind: 'cut', key: s.key };
      }
      if (s.level === 'line' && s.area) return s.area;
      const ids = selectedLines(s, plan);
      return ids.length ? AREAS.ofLines(doc, plan, ids) : null;
    }

    // The group a change of an area review is shown in: E's `group` (materials | area | cuts | lyrics | outside | work |
    // lines | time), or the v2 group of its kind.
    function groupOfChange(c) { return c.group && DIRECT_ORDER.includes(c.group) ? c.group : CH.groupOf(c); }

    // directGroups(changes, areaKeys) → [{ group, areaKey?, changes }] in review order: 素材, one 区画 group per area (in
    // the order the briefs named them), カット, …, 区画の外.
    function directGroups(changes, areaKeys) {
      const keys = (areaKeys || []).slice();
      for (const c of changes) if (groupOfChange(c) === 'area' && c.areaKey && !keys.includes(c.areaKey)) keys.push(c.areaKey);
      const out = [];
      for (const group of DIRECT_ORDER) {
        if (group === 'area') {
          for (const key of keys) {
            const list = changes.filter((c) => groupOfChange(c) === 'area' && c.areaKey === key);
            if (list.length) out.push({ group, areaKey: key, changes: list });
          }
          const loose = changes.filter((c) => groupOfChange(c) === 'area' && !c.areaKey);
          if (loose.length) out.push({ group, areaKey: null, changes: loose });
          continue;
        }
        const list = changes.filter((c) => groupOfChange(c) === group);
        if (list.length) out.push({ group, changes: list });
      }
      return out;
    }

    // aggRows(changes) → [{ agg, changes }] (one aggregate row per `agg`, at its first member) or [{ change }].
    function aggRows(changes) {
      const out = [];
      const at = new Map();
      for (const c of changes) {
        if (c.agg) {
          if (at.has(c.agg)) { at.get(c.agg).changes.push(c); continue; }
          const row = { agg: c.agg, changes: [c] };
          at.set(c.agg, row);
          out.push(row);
        } else out.push({ change: c });
      }
      // An aggregate of one line reads as that line's own row.
      return out.map((r) => (r.agg && r.changes.length === 1 ? { change: r.changes[0] } : r));
    }

    // The tri-state of an aggregate row (role="checkbox", aria-checked mixed, §6.10).
    function aggState(list) {
      const on = list.filter(isChecked).length;
      return on === 0 ? 'false' : on === list.length ? 'true' : 'mixed';
    }

    // A change is disabled while a change it requires (its new material) is unchecked (§6.4 dependencies).
    function isDisabled(c, list) {
      if (!Array.isArray(c.requires) || !c.requires.length) return false;
      return c.requires.some((id) => { const r = list.find((x) => x.id === id); return !r || !isChecked(r); });
    }

    // withToggle(changes, id, on) → the list with the row checked or not. Unchecking a material unchecks every change that
    // requires it; checking it again leaves them unchecked (they are re-enabled). A disabled row cannot be checked.
    function withToggle(changes, id, on) {
      const target = changes.find((c) => c.id === id);
      if (!target || (on && isDisabled(target, changes))) return changes;
      let next = withChecked(changes, id, on);
      if (!on) {
        const dropped = new Set([id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const c of next) {
            if (!dropped.has(c.id) && Array.isArray(c.requires) && c.requires.some((r) => dropped.has(r))) { dropped.add(c.id); grew = true; }
          }
        }
        next = next.map((c) => (dropped.has(c.id) && isChecked(c) ? Object.assign({}, c, { checked: false }) : c));
      }
      return next;
    }

    // withAggToggle(changes, agg, on) → every member of the aggregate checked or not (disabled members stay unchecked).
    function withAggToggle(changes, agg, on) {
      let next = changes;
      for (const c of changes) if (c.agg === agg) next = withToggle(next, c.id, on);
      return next;
    }

    // withAsk(side, key, text, rev) → side.asks with the board draft of an area (≤ 120 characters, at most 40 drafts:
    // the oldest go first); an empty text removes the draft. Drafts are not undoable (§2.1).
    function withAsk(side, key, text, rev) {
      const asks = Object.assign({}, side && side.asks && typeof side.asks === 'object' ? side.asks : {});
      const v = String(text || '').replace(/[\r\n]+/g, ' ').slice(0, ASK_MAX);
      if (!v.trim()) delete asks[key]; else asks[key] = { text: v, at: Number.isInteger(rev) ? rev : 0 };
      const keys = Object.keys(asks);
      if (keys.length > ASKS_CAP) {
        keys.sort((a, b) => asks[a].at - asks[b].at || (a < b ? -1 : 1));
        for (const k of keys.slice(0, keys.length - ASKS_CAP)) delete asks[k];
      }
      return Object.assign({}, side, { asks });
    }

    // boardBriefs(rows, asks) → the briefs of the board's rows that have a draft ([{ ref, instruction }], in row order),
    // and whether more than MAX_BRIEFS would go (then 送る is off, ai.board.max).
    function boardBriefs(rows, asks) {
      const briefs = [];
      for (const r of rows) {
        const a = asks && asks[r.key];
        if (a && typeof a.text === 'string' && a.text.trim()) briefs.push({ ref: r.ref, instruction: a.text.trim() });
      }
      return { briefs: briefs.slice(0, MAX_BRIEFS), over: briefs.length > MAX_BRIEFS, count: briefs.length };
    }

    // refOfKey(key) → the AreaRef of an area key (a board draft of an added area), or null.
    function refOfKey(key) {
      const k = String(key || '');
      if (k === 'work') return { kind: 'work' };
      let m = /^song:(\d+)@([0-9.]+)-([0-9.]+)$/.exec(k);
      if (m) return { kind: 'song', n: Number(m[1]), t0: Number(m[2]), t1: Number(m[3]) };
      m = /^(head|para):(.+)$/.exec(k);
      if (m) return { kind: m[1], rowId: m[2] };
      m = /^kind:(.+)$/.exec(k);
      if (m) return { kind: 'songKind', of: m[1] };
      m = /^lines:(.+)$/.exec(k);
      if (m) return { kind: 'lines', ids: m[1].split(',') };
      m = /^cut:(.+)$/.exec(k);
      return m ? { kind: 'cut', key: m[1] } : null;
    }

    // ---- the controller ------------------------------------------------------------------------------------------------

    // createController(host, deps) → the AI panel's state and verbs.
    // host: { t, lang, registry, doc, plan, rev, side (getters), batch(meta, cmds), setSide(fn), undo(), toast(text, opts),
    //         setReviewOpen(on), tryOn(doc | null, badge), altShown(), song() → { sha1, seconds, buffer | null } | null,
    //         now() → ms, nextFrame() → Promise } (ui/ai_panel builds it from the app).
    // deps: { session, local (Storage-like), fetchImpl, SDK } — injected, so Node tests never touch a network.
    function createController(host, deps) {
      const d = deps || {};
      const t = host.t;
      const keys = createKeyStore(d.session || null, d.local || null);
      const settings = readSettings(d.local || null);
      const listeners = [];
      const consented = new Set();        // song sha1s the user agreed to send, for this project only (§4.22.6)
      // ai/direct and ai/recipe (package E), injected by ui/ai_panel; a build without them says boot.soon.
      const DIRECT = d.direct || null;
      const RECIPE = d.recipe || null;
      const VISION = d.vision || null;
      // The asset ids of the one 「AIに説明してもらう」 the user has just agreed to (§11.6.2): the consent is asked every
      // time pictures are sent, so it holds for that one run only.
      const visionAgreed = new Set();
      let seq = 0;
      let checking = null;                // the AbortController of a running key check
      let state = initialState();

      function initialState() {
        const provider = settings.provider;
        const k = keys.load(provider);
        const model = settings.models[provider];
        return {
          provider, model, remember: settings.remember || k.remembered, key: k.key, okModel: k.ok,
          keyStatus: keyStatus(provider, k.key, k.ok, model), keyName: null, keyError: null,
          run: null, review: null, error: null, notice: null, tryOn: null,
          applied: [],                    // the area keys of the last applied area review (the board's 反映済み)
          // 写真・動画をAIが使ってよい (DESIGN_2_1 §11.6.1): one switch for the instruction block and the board
          allowMedia: true,
        };
      }

      function emit() { for (const fn of listeners.slice()) fn(state); }
      function set(patch) { state = Object.assign({}, state, patch); emit(); }
      function on(fn) {
        listeners.push(fn);
        return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
      }
      function saveSettings() {
        writeSettings(d.local || null, { provider: state.provider, models: settings.models, remember: state.remember });
      }

      // --- connection -------------------------------------------------------------------------------------------------

      function cancelCheck() {
        if (!checking) return;
        const ac = checking;
        checking = null;
        ac.abort();
      }

      function setProvider(provider) {
        if (!providerOk(provider) || provider === state.provider || state.run) return;
        cancelCheck();
        const k = keys.load(provider);
        const model = settings.models[provider];
        state = Object.assign({}, state, {
          provider, model, key: k.key, okModel: k.ok, keyStatus: keyStatus(provider, k.key, k.ok, model), keyName: null,
          keyError: null, error: null,
        });
        saveSettings();
        emit();
      }

      function setModel(model) {
        if (!modelOk(state.provider, model) || model === state.model || state.run) return;
        cancelCheck();
        settings.models[state.provider] = model;
        saveSettings();
        set({ model, keyStatus: keyStatus(state.provider, state.key, state.okModel, model), keyName: null, keyError: null });
      }

      function setKey(text) {
        const key = String(text || '').trim();
        if (key === state.key) return;
        cancelCheck();
        keys.save(state.provider, key, state.remember, null);
        set({ key, okModel: null, keyStatus: keyStatus(state.provider, key, null, state.model), keyName: null, keyError: null });
      }

      // Moves every stored key to the chosen storage.
      function setRemember(onOff) {
        const remember = !!onOff;
        if (remember === state.remember) return;
        for (const p of Object.keys(PR.PROVIDERS)) {
          const k = p === state.provider ? { key: state.key, ok: state.okModel } : keys.load(p);
          if (k.key) keys.save(p, k.key, remember, k.ok);
        }
        state = Object.assign({}, state, { remember });
        saveSettings();
        emit();
      }

      function forgetKey() {
        cancelCheck();
        keys.clear(state.provider);
        set({ key: '', okModel: null, keyStatus: 'unset', keyName: null, keyError: null });
      }

      // Every service's key leaves both storages (≡ › 設定 › この端末に保存した作品と曲を消す); the service and model
      // choices stay, they are not secret.
      function forgetKeys() {
        cancelCheck();
        keys.clearAll();
        set({ key: '', okModel: null, keyStatus: 'unset', keyName: null, keyError: null });
      }

      // [確認]: the free model-info request (§4.22.1). → true when the key works for the chosen model.
      async function checkKey() {
        if (!state.key) { set({ keyStatus: 'unset', keyError: 'no_key' }); return false; }
        cancelCheck();
        const ac = new AbortController();
        checking = ac;
        const { provider, model, key } = state;
        set({ keyStatus: 'checking', keyError: null });
        try {
          const res = await PR.checkKey({ provider, model, apiKey: key, signal: ac.signal, fetchImpl: d.fetchImpl, SDK: d.SDK });
          if (checking !== ac) return false;
          checking = null;
          confirmKey(provider, model, key, (res && res.name) || model);
          return true;
        } catch (e) {
          if (checking !== ac) return false;
          checking = null;
          const code = codeOf(e);
          set({ keyStatus: statusOfError(code) || keyStatus(provider, key, null, model), keyError: code });
          return false;
        }
      }

      // The key answered for this model (a check or a successful request): remember that, the card collapses.
      function confirmKey(provider, model, key, name) {
        if (provider !== state.provider || key !== state.key) return;
        keys.save(provider, key, state.remember, model);
        set({ okModel: model, keyStatus: model === state.model ? 'ok' : state.keyStatus, keyName: name || state.keyName, keyError: null });
      }

      // --- availability -----------------------------------------------------------------------------------------------

      // Why the 曲を使う tools cannot be used (a string key), ignoring consent; null when they can.
      function songBlocked() {
        if (!PR.PROVIDERS[state.provider].audio) return 'ai.song.onlyGemini';
        const song = host.song();
        if (!song) return 'ai.song.noSong';
        if (!song.buffer) return 'ai.song.notLinked';
        return null;
      }

      function hasConsent() {
        const song = host.song();
        return !!song && consented.has(song.sha1);
      }

      // Why 写真の説明 cannot be used, ignoring consent: pictures go to Google Gemini only (the service that takes media
      // parts, as it takes the song's audio); null when it can.
      function visionBlocked() {
        if (!VISION) return 'boot.soon';
        return PR.PROVIDERS[state.provider].audio ? null : 'ai.visionOnlyGemini';
      }

      // Why a tool cannot run now (the disabled reason, a string key), or null.
      function blocked(tool) {
        if (!TOOLS.includes(tool)) return 'ai.needLines';
        if (state.run) return 'ai.needIdle';
        if (state.review) return 'ai.needReview';
        if (!state.key) return 'ai.needKey';
        if (tool === 'vision') return visionBlocked();          // pictures, not lines: it works before the lyrics too
        if (tool === 'material' && !RECIPE) return 'boot.soon';
        if (tool === 'direct' && !DIRECT) return 'boot.soon';
        if (SONG_TOOLS.includes(tool)) {
          const why = songBlocked();
          if (why) return why;
          if (!hasConsent()) return 'ai.song.needConsent';
          if (tool !== 'align') return null;
        }
        const plan = host.plan;
        return plan && Array.isArray(plan.lines) && plan.lines.length ? null : 'ai.needLines';
      }

      // 写真・動画をAIが使ってよい: while it is off, 指示 and the board offer no [media] list (askDirect).
      function setAllowMedia(onOff) {
        if (state.allowMedia !== !!onOff) set({ allowMedia: !!onOff });
      }

      function consent(onOff) {
        const song = host.song();
        if (!song) return;
        if (onOff) consented.add(song.sha1); else consented.delete(song.sha1);
        emit();
      }

      // --- runs -------------------------------------------------------------------------------------------------------

      function isCurrent(id) { return !!state.run && state.run.id === id; }

      function setStage(id, stage) {
        if (isCurrent(id) && state.run.stage !== stage) set({ run: Object.assign({}, state.run, { stage }) });
      }

      function call(conn, req, signal, media) {
        return PR.call({
          provider: conn.provider, model: conn.model, apiKey: conn.key, system: req.system, prompt: req.prompt,
          schema: req.schema, effort: req.effort, signal, fetchImpl: d.fetchImpl, SDK: d.SDK, media,
        });
      }

      // The song as a request part: 音声を準備中 (16 kHz mono WAV) → アップロード中 → 処理中 (Files API only).
      async function audioPart(conn, song, signal, id) {
        await host.nextFrame();                    // let the stage line paint before the encode takes the thread
        if (signal.aborted) throw new PR.AIError('aborted');
        const audio = SONG.audioFromBuffer(song.buffer);
        if (signal.aborted) throw new PR.AIError('aborted');
        return SONG.audioPart({ audio, apiKey: conn.key, signal, fetchImpl: d.fetchImpl, onStage: (s) => setStage(id, s) });
      }

      // 指示: one request per window of ≤ 200 area lines (ai/direct.directRequests), run in sequence and merged into one
      // review (ai/direct gives window k's change ids the prefix 'w<k>:'). A service that refuses the full schema
      // (bad_request) is asked once more without materials (ai.materialsFailed).
      async function askDirect(conn, sent, o, signal) {
        const reg = host.registry;
        let allow = !!o.allowMaterials;
        // o.media: the asset ids the AI may place (DESIGN_2_1 §11.6.1: bytes on this device), offered only while
        // 写真・動画をAIが使ってよい is on — whichever block sent the request
        const media = state.allowMedia && Array.isArray(o.media) && o.media.length ? o.media.slice() : false;
        const make = () => DIRECT.directRequests(sent.doc, sent.plan, reg, { briefs: o.briefs, uiLang: host.lang, mode: o.mode || 'all',
          allowMaterials: allow, media });
        let reqs = make();
        let failed = false;
        let outs = [];
        const usage = { input: 0, output: 0 };
        let model = null;
        for (let k = 0; k < reqs.length; k++) {
          let res;
          try {
            res = await call(conn, reqs[k], signal);
          } catch (e) {
            if (!(allow && !failed && codeOf(e) === 'bad_request')) throw e;
            failed = true;
            allow = false;
            reqs = make();
            outs = [];
            usage.input = usage.output = 0;
            k = -1;
            continue;
          }
          if (res.usage) { usage.input += Number(res.usage.input) || 0; usage.output += Number(res.usage.output) || 0; }
          model = res.model || model;
          // ai/direct prefixes the ids of window k with 'w<k>:' itself (its `sent.window`); the materials of the earlier
          // windows take their room in doc.materials first
          const materialsBefore = [].concat(...outs.map((x) => (x.changes || []).filter((c) => c.kind === 'material')));
          outs.push(DIRECT.directChanges(sent.doc, sent.plan, reg, res.json, { rev: sent.rev, sent: reqs[k].sent, allowMaterials: allow,
            materialsBefore }));
        }
        const merged = { results: [], changes: [], warnings: [] };
        for (const out of outs) {
          merged.results.push(...(out.results || []));
          merged.changes.push(...(out.changes || []));
          merged.warnings.push(...(out.warnings || []));
        }
        return { res: { usage, model }, out: merged, materialsFailed: failed };
      }

      // AIで作り直す on a material with a photo or video layer (DESIGN_2_1 §11.5.8): the [media] list, so its pictures stay
      // 'asset:<n>'. While 写真・動画をAIが使ってよい is on, the pictures on this device (`here`, asset ids) and the
      // material's own, with their vision text; while it is off, only the material's own, without it. null: no media layer.
      function remakeMedia(doc, current, here, lang) {
        const layers = current.recipe && Array.isArray(current.recipe.layers) ? current.recipe.layers : [];
        const own = layers.filter((l) => l && l.prim === 'media');
        if (!own.length) return null;
        const ids = own.map((l) => l.src).filter(Boolean);
        if (!state.allowMedia) return RECIPE.mediaSent(doc, { only: ids, lang, described: false });
        return RECIPE.mediaSent(doc, { only: ids.concat(Array.isArray(here) ? here : []), lang });
      }

      // The briefs as the review names them: { key, ref, label, n, instruction } from the document they were sent from.
      function briefsOf(briefs, doc, plan) {
        return briefs.map((b) => {
          const area = AREAS.resolve(doc, plan, b.ref);
          return { key: AREAS.keyOf(b.ref), ref: b.ref, label: area ? area.label : ['area.work', {}], n: area ? area.n : 0,
            instruction: String(b.instruction || '') };
        });
      }

      // Sends one request and validates the answer against what was sent (`sent`: the doc, plan and rev at the start).
      async function ask(tool, conn, sent, opts, song, signal, id) {
        const lang = host.lang;
        const reg = host.registry;
        const valid = { rev: sent.rev };
        if (tool === 'direct') return askDirect(conn, sent, opts, signal);
        if (tool === 'vision') {
          // the host makes the JPEGs (a still: one at 768 px; a video: three frames); only they and the prompt are sent
          const items = await host.visionParts(opts.ids);
          if (signal.aborted) throw new PR.AIError('aborted');
          const req = VISION.visionRequest(sent.doc, items, { uiLang: lang });
          if (!req.sent.items.length) return { res: {}, out: { changes: [], warnings: [['ai.warn.empty', {}]] } };
          const res = await call(conn, req, signal, req.media);
          return { res, out: VISION.visionChanges(sent.doc, res.json, req.sent, valid) };
        }
        if (tool === 'material') {
          const remake = opts.current ? { current: opts.current, media: remakeMedia(sent.doc, opts.current, opts.media, lang) } : {};
          const req = RECIPE.materialRequest(sent.doc, sent.plan, reg, Object.assign({ description: String(opts.description || '').slice(0, MAX_INSTRUCTION),
            kind: opts.kind, scope: opts.scope, uiLang: lang }, remake));
          const res = await call(conn, req, signal);
          return { res, out: RECIPE.materialChanges(sent.doc, sent.plan, reg, res.json, Object.assign(valid, { sent: req.sent }, opts.useAt ? { useAt: opts.useAt } : {})) };
        }
        if (tool === 'prep') {
          const req = PREP.request(sent.doc, lang);
          const res = await call(conn, req, signal);
          return { res, out: PREP.changes(sent.doc, res.json, Object.assign(valid, { lines: req.lines })) };
        }
        if (tool === 'looks') {
          const req = LOOKS.proposalsRequest(sent.doc, sent.plan, reg, lang);
          const res = await call(conn, req, signal);
          return { res, out: LOOKS.proposalChanges(sent.doc, sent.plan, reg, res.json, Object.assign(valid, { lines: req.lines })) };
        }
        if (tool === 'edit') {
          const lineIds = Array.isArray(opts.lineIds) && opts.lineIds.length ? opts.lineIds.slice() : null;
          const text = String(opts.instruction || '').slice(0, MAX_INSTRUCTION);
          const req = LOOKS.editRequest(sent.doc, sent.plan, reg, text, lang, lineIds ? { lineIds } : undefined);
          const res = await call(conn, req, signal);
          return { res, out: LOOKS.editChanges(sent.doc, sent.plan, reg, res.json, Object.assign(valid, { lines: req.lines, lineIds })) };
        }
        const part = await audioPart(conn, song, signal, id);
        setStage(id, 'think');
        if (tool === 'transcribe') {
          const res = await call(conn, SONG.transcribeRequest(lang), signal, [part]);
          return { res, out: SONG.transcriptLines(res.json, song.seconds) };
        }
        if (tool === 'align') {
          const req = SONG.alignRequest(sent.doc, sent.plan, lang);
          const res = await call(conn, req, signal, [part]);
          return { res, out: SONG.alignChanges(sent.doc, sent.plan, res.json, song.seconds, Object.assign(valid, { lines: req.lines })) };
        }
        const res = await call(conn, SONG.analyzeRequest(lang), signal, [part]);
        return { res, out: SONG.analyzeChanges(sent.doc, res.json, song.seconds, valid) };
      }

      // An area review (指示, 素材づくり): the questions per area, a summary, the changes grouped by area (DESIGN_2_1 §6.4).
      function directResult(tool, base, got, o, sent) {
        const out = got.out || {};
        const changes = Array.isArray(out) ? out : out.changes || [];
        const results = Array.isArray(out.results) ? out.results
          : [{ s: 0, areaKey: null, understood: out.understood !== false, summary: out.summary || '', question: out.question || '' }];
        const briefs = tool === 'direct' ? briefsOf(o.briefs, sent.doc, sent.plan) : [];
        const questions = results.filter((r) => r && r.understood === false)
          .map((r) => ({ areaKey: r.areaKey || null, text: r.question || r.summary || '' }));
        const summary = results.filter((r) => r && r.understood !== false && r.summary).map((r) => r.summary).join(' ');
        const extra = { briefs, mode: o.mode || 'all', materialsFailed: !!got.materialsFailed };
        if (!changes.length) {
          if (questions.length) {
            return { notice: Object.assign({ kind: 'question', tool, text: questions.map((q) => q.text).filter(Boolean).join(' '), questions,
              warnings: base.warnings }, extra) };
          }
          return { notice: Object.assign({ kind: 'nothing', tool, text: summary, warnings: base.warnings }, extra) };
        }
        return { review: Object.assign(base, extra, { kind: 'direct', summary, questions, changes }) };
      }

      // The answer → { review } (something to choose from) or { notice } (a question, or nothing to change).
      function resultOf(tool, id, conn, got, o, sent) {
        const { res, out } = got;
        const base = { id, tool, usage: res.usage || null, provider: conn.provider, model: res.model || conn.model,
          warnings: (out && out.warnings) || [] };
        const nothing = (text) => ({ notice: { kind: 'nothing', tool, text: text || '', warnings: base.warnings } });
        if (tool === 'direct' || tool === 'material') return directResult(tool, base, got, o || {}, sent);
        if (tool === 'edit' && !out.understood) {
          return { notice: { kind: 'question', tool, text: out.question || out.summary || '', warnings: base.warnings } };
        }
        if (tool === 'looks') {
          const proposals = out.proposals.filter((p) => p.changes.length);
          if (!proposals.length) return nothing();
          return { review: Object.assign(base, { kind: 'looks', topic: out.theme, season: out.season, proposals }) };
        }
        if (tool === 'transcribe') {
          if (!out.lines.length) return { notice: { kind: 'empty', tool, text: out.note || '', warnings: base.warnings } };
          return { review: Object.assign(base, { kind: 'transcript', result: out, withTimes: true }) };
        }
        if (tool === 'analyze') return { review: Object.assign(base, { kind: 'analysis', info: out.info, changes: out.changes }) };
        const summary = out.summary || out.note || '';
        if (!out.changes.length) return nothing(summary);
        return { review: Object.assign(base, { kind: 'list', summary, changes: out.changes }) };
      }

      // run(tool, opts) → true when a review or a notice came back. opts (edit): { instruction, lineIds }; (direct):
      // { briefs: [{ ref, instruction }], mode: 'all' | 'camera', allowMaterials, media }; (material): { description, kind,
      // scope? ('cut' | 'run': an ornament for that place), current?, useAt?, media? (a remake: the asset ids on this device) }.
      async function run(tool, opts) {
        const o0 = opts || {};
        const why = blocked(tool, o0);
        if (why) {
          if (why === 'ai.needKey') set({ error: { code: 'no_key', tool } });
          return false;
        }
        let o = o0;
        if (tool === 'direct') {
          const camera = o.mode === 'camera';
          const briefs = (Array.isArray(o.briefs) ? o.briefs : []).filter((b) => b && b.ref && (camera || String(b.instruction || '').trim()))
            .slice(0, MAX_BRIEFS).map((b) => ({ ref: b.ref, instruction: String(b.instruction || '').replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_INSTRUCTION) }));
          if (!briefs.length) return false;
          o = Object.assign({}, o, { briefs });
        }
        if (tool === 'material' && !String(o.description || '').trim()) return false;
        if (tool === 'vision') {
          const ids = (Array.isArray(o.ids) ? o.ids : []).filter((x) => visionAgreed.has(x));
          visionAgreed.clear();
          if (!ids.length) return false;
          o = Object.assign({}, o, { ids });
        }
        if (tool === 'edit' && !String(o.instruction || '').trim()) return false;
        const ac = new AbortController();
        seq += 1;
        const id = host.now().toString(36) + '-' + seq;
        const conn = { provider: state.provider, model: state.model, key: state.key };
        const sent = { doc: host.doc, plan: host.plan, rev: host.rev };
        const song = SONG_TOOLS.includes(tool) ? host.song() : null;
        set({ run: { id, tool, stage: song ? 'prepare' : 'think', started: host.now(), abort: ac }, error: null, notice: null });
        let got;
        try {
          got = await ask(tool, conn, sent, o, song, ac.signal, id);
        } catch (e) {
          if (!isCurrent(id)) return false;
          const code = codeOf(e);
          if (code === 'internal' && typeof console !== 'undefined') console.error(e);
          const status = statusOfError(code);
          const patch = { run: null, error: { code, tool } };
          if (status && conn.key === state.key && conn.provider === state.provider) patch.keyStatus = status;
          set(patch);
          return false;
        }
        if (!isCurrent(id)) return false;
        let result;
        try {
          result = resultOf(tool, id, conn, got, o, sent);
        } catch (e) {
          if (typeof console !== 'undefined') console.error(e);
          set({ run: null, error: { code: 'internal', tool } });
          return false;
        }
        confirmKey(conn.provider, conn.model, conn.key, null);
        if (got.materialsFailed) host.toast(t('ai.materialsFailed'), { kind: 'warn' });
        if (result.notice) { set({ run: null, notice: result.notice }); return true; }
        const review = mapChanges(result.review, (list) => stale(result.review, list));
        host.setReviewOpen(true);
        set({ run: null, review });
        return true;
      }

      // The areas of an area review, resolved now (stale 'left' rows, the area check of toCommands, §5.6). The resolver
      // takes an area key or an AreaRef → the Area, null when it is gone, undefined for a key it cannot read (then
      // ai/changes makes no area check).
      function resolverOf(review) {
        const briefs = (review && review.briefs) || [];
        return (x) => {
          const ref = typeof x === 'string' ? ((briefs.find((b) => b.key === x) || {}).ref || refOfKey(x)) : x;
          return ref ? AREAS.resolve(host.doc, host.plan, ref) : undefined;
        };
      }

      function stale(review, list) {
        if (review && review.kind === 'direct') return CH.markStale(host.doc, host.plan, list, { resolveArea: resolverOf(review) });
        return CH.markStale(host.doc, host.plan, list);
      }

      // [中止]: the request is cancelled (fetch and upload polling stop on the signal).
      function abort() {
        const r = state.run;
        if (!r) return;
        r.abort.abort();
        set({ run: null, error: { code: 'aborted', tool: r.tool } });
      }

      function dismiss() { if (state.error || state.notice) set({ error: null, notice: null }); }

      // --- the review ---------------------------------------------------------------------------------------------------

      function updateReview(review) {
        set({ review });
        if (state.tryOn) tryOn(state.tryOn.index);     // the try-on follows the checks
      }

      function toggle(id, onOff, index) {
        const r = state.review;
        if (!r) return;
        // An area review keeps its dependencies: a material unchecked unchecks the rows that need it (§6.4).
        const flip = r.kind === 'direct' ? withToggle : withChecked;
        updateReview(mapChanges(r, (list, p) => (p === null || r.proposals.indexOf(p) === index ? flip(list, id, onOff) : list)));
      }

      // An aggregate row (one change per area line, `agg`): every member at once.
      function toggleAgg(agg, onOff) {
        const r = state.review;
        if (!r || r.kind !== 'direct') return;
        updateReview(mapChanges(r, (list) => withAggToggle(list, agg, onOff)));
      }

      function toggleAll(onOff, index) {
        const r = state.review;
        if (!r) return;
        updateReview(mapChanges(r, (list, p) => (p === null || r.proposals.indexOf(p) === index ? withAll(list, onOff) : list)));
      }

      function setTranscriptTimes(onOff) {
        const r = state.review;
        if (r && r.kind === 'transcript') set({ review: Object.assign({}, r, { withTimes: !!onOff }) });
      }

      // The document changed while a review is open: rows whose target changed since the request become stale.
      function docChanged() {
        let next = state;
        if (state.tryOn && !host.altShown()) next = Object.assign({}, next, { tryOn: null });   // an edit ended the try-on
        const r = state.review;
        if (r) {
          const review = mapChanges(r, (list) => stale(r, list));
          if (review !== r) next = Object.assign({}, next, { review });
        }
        if (next !== state) { state = next; emit(); }
      }

      // A new or opened project: nothing of the old one's AI state stays (the consent is for that project only).
      function projectChanged() {
        if (state.run) state.run.abort.abort();
        consented.clear();
        visionAgreed.clear();
        const hadReview = !!state.review;
        endTryOn();
        state = Object.assign({}, state, { run: null, review: null, error: null, notice: null });
        if (hadReview) host.setReviewOpen(false);
        emit();
      }

      function close() {
        endTryOn();
        const had = !!state.review;
        state = Object.assign({}, state, { review: null });
        if (had) host.setReviewOpen(false);
        emit();
      }

      function discard() { close(); }

      // The review comes back after the store refused its commands (the store reports why).
      function reopen(review) {
        state = Object.assign({}, state, { review: mapChanges(review, (list) => stale(review, list)) });
        host.setReviewOpen(true);
        emit();
      }

      // The undo label of an area review: 「AI: サビ1（5件）」, the whole video as 「AI: 指示（5件）」 (§5.6).
      function areaUndoLabel(review, n) {
        const briefs = review.briefs || [];
        if (!briefs.length || briefs.every((b) => b.ref && b.ref.kind === 'work')) return ['undo.ai', { tool: t('ai.name.' + review.tool), n }];
        const names = briefs.map((b) => {
          const p = Object.assign({}, b.label[1] || {});
          if (typeof p.kind === 'string' && t.has('songSec.' + p.kind)) p.kind = t('songSec.' + p.kind);
          return t(b.label[0], p);
        });
        return ['undo.aiArea', { area: names.join(t('list.sep')), n }];
      }

      // Dispatches the chosen changes as one undo step (store.batch), then logs them for selective revert. When nothing
      // can be applied the review stays open: nothing is lost before [捨てる] (§6.4.10.5).
      function commit(review, checked, lookTitle) {
        const doc = host.doc;
        const plan = host.plan;
        const area = review.kind === 'direct';
        const opts = area ? { resolveArea: resolverOf(review) } : undefined;
        const cmds = checked.length ? CH.toCommands(doc, plan, checked, opts) : [];
        if (!cmds.length) { host.toast(t('ai.review.nothingApplied'), { kind: 'warn' }); return 0; }
        const n = review.kind === 'transcript' ? review.result.lines.length : checked.length;
        const meta = { runId: review.id, tool: review.tool, n };
        if (area) {
          meta.areas = (review.briefs || []).map((b) => ({ key: b.key, label: b.label }));
          meta.instructions = (review.briefs || []).map((b) => b.instruction.slice(0, MAX_INSTRUCTION));
        }
        const entry = Object.assign(CH.logEntry(doc, cmds, meta), { at: host.now() });
        if (area && !entry.areas) Object.assign(entry, { areas: meta.areas, instructions: meta.instructions });
        entry.groups = changeGroups(doc, plan, checked, entry.applied);
        close();
        host.batch({ label: area ? areaUndoLabel(review, n) : ['undo.ai', { tool: t('ai.name.' + review.tool), n }] }, cmds);
        if (host.doc === doc) { reopen(review); return 0; }
        if (area) set({ applied: (review.briefs || []).map((b) => b.key) });
        host.setSide((side) => withLog(side, entry));
        // §3.7: この案にする appends to the look history; entries hold seeds and salts only, so this adds one only
        // when the current look is not already the newest entry.
        if (lookTitle) host.setSide((side) => LK.record(side, host.doc, { kind: 'append', scope: 'work', label: ['look.ai', { title: lookTitle }] }));
        host.toast(review.kind === 'analysis' ? t('ai.an.saved') : t('ai.review.applied', { n }),
          { kind: 'ok', action: { label: t('cmd.edit.undo'), run: host.undo } });
        return n;
      }

      // [選んだ n 件を反映] / この案にする (index = the proposal) / 分析 [保存する]. → the number of changes applied.
      function apply(index) {
        const r = state.review;
        if (!r || r.kind === 'transcript') return 0;
        const idx = r.kind === 'looks' ? index : -1;
        if (r.kind === 'looks' && !r.proposals[idx]) return 0;
        // A row whose material is unchecked is left out (it could not apply, §6.4).
        const now = stale(r, changesOf(r, idx));
        const checked = now.filter((c) => isChecked(c) && !isDisabled(c, now));
        const title = r.kind === 'looks' ? (r.proposals[idx].title || t('ai.looks.letter', { k: letter(idx) })) : null;
        return commit(r, checked, title);
      }

      // 書き起こし: [置き換える] ('replace') / [後ろに足す] ('append').
      function applyTranscript(mode) {
        const r = state.review;
        if (!r || r.kind !== 'transcript') return 0;
        const change = SONG.transcriptChange(host.doc, r.result, mode, { rev: host.rev, withTimes: r.withTimes });
        return commit(r, [change], null);
      }

      // --- try-on (試写, §6.4.10.7) ---------------------------------------------------------------------------------

      // The stage shows plan(apply(doc, checked changes)) without committing anything. index: the proposal (3案) or -1.
      function tryOn(index) {
        const r = state.review;
        if (!r || !(r.kind === 'looks' || r.kind === 'list' || r.kind === 'direct')) return;
        const idx = r.kind === 'looks' ? index : -1;
        if (r.kind === 'looks' && !r.proposals[idx]) return;
        const all = changesOf(r, idx);
        const list = all.filter((c) => isChecked(c) && !isDisabled(c, all));
        let doc = host.doc;
        try {
          if (list.length) doc = CH.apply(host.doc, host.plan, list, r.kind === 'direct' ? { resolveArea: resolverOf(r) } : undefined);
        } catch (e) {
          if (typeof console !== 'undefined') console.error(e);
          set({ error: { code: 'internal', tool: r.tool } });
          return;
        }
        const k = idx >= 0 ? letter(idx) : null;
        const badge = k ? t('ai.tryOn.badge', { k }) : t('ai.tryOn.badgeList');
        state = Object.assign({}, state, { tryOn: { index: idx, doc, badge } });
        host.tryOn(doc, badge);
        emit();
      }

      function endTryOn() {
        if (!state.tryOn) return;
        state = Object.assign({}, state, { tryOn: null });
        host.tryOn(null);
        emit();
      }

      // Something else took the stage (a part tile, a theme swatch): our try-on is over.
      function tryOnReplaced(doc) {
        if (state.tryOn && doc !== state.tryOn.doc) set({ tryOn: null });
      }

      // The play bar's mode strip while trying on: 「案Bを試写中 [この案にする] [やめる]」; with nothing checked only
      // [やめる] (like the card's own [この案にする], which is disabled then).
      function strip() {
        const tr = state.tryOn;
        if (!tr || !host.altShown()) return null;
        const k = tr.index >= 0 ? letter(tr.index) : null;
        const actions = [{ label: t('ai.tryOn.stop'), run: endTryOn }];
        if (counts(changesOf(state.review, tr.index)).checked) {
          actions.unshift({ label: k ? t('ai.looks.pick') : t('ai.tryOn.apply'), run: () => apply(tr.index) });
        }
        return { kind: 'tryon', text: k ? t('ai.tryOn.strip', { k }) : t('ai.tryOn.stripList'), actions };
      }

      // --- the log: selective revert, AI pins ----------------------------------------------------------------------

      function logEntries() { const s = host.side; return s && Array.isArray(s.aiLog) ? s.aiLog : []; }

      // [元に戻す] of one log entry: only what the document still holds from that run (§4.22.5). → { n, kept } or null,
      // counted like the log entry (the changes that were applied).
      function revert(runId) {
        const entry = logEntries().find((e) => e && e.runId === runId);
        if (!entry) return null;
        const res = CH.revertCommands(host.doc, entry);
        const { cmds } = res;
        const { n, kept } = revertTally(host.doc, entry, res.kept);
        if (!cmds.length) { host.toast(t('ai.log.nothing'), { kind: 'warn' }); return { n: 0, kept }; }
        const before = host.doc;
        host.batch({ label: ['undo.aiRevert', { tool: t('ai.name.' + entry.tool) }] }, cmds);
        if (host.doc === before) return { n: 0, kept };      // nothing changed (the store reported any error)
        const text = [n ? t('ai.log.reverted', { n }) : '', kept ? t('ai.log.kept', { n: kept }) : ''].filter(Boolean).join('\n');
        host.toast(text, { kind: kept ? 'warn' : 'ok', action: { label: t('cmd.edit.undo'), run: host.undo } });
        return { n, kept };
      }

      // 「AIに説明してもらう」 (DESIGN_2_1 §11.6.2): the assets on this device (at most 8), a consent every time (it states
      // what is sent: 768 px JPEGs, about {kb} KB each, three frames of a video; nothing is remembered), then the vision
      // tool; its review opens in the AI tab. → Promise<boolean>: true when a review or a notice came back.
      async function describeMedia(ids) {
        const list = [...new Set(Array.isArray(ids) ? ids : [])].filter((x) => host.mediaHere(x)).slice(0, VISION ? VISION.MAX_ITEMS : 0);
        const why = blocked('vision');
        if (why === 'ai.needKey') { host.openAi(); set({ error: { code: 'no_key', tool: 'vision' } }); return false; }
        if (why) { host.toast(t(why), { kind: 'warn' }); return false; }
        // the pictures asked about are not on this device: say so (nothing would be sent)
        if (!list.length) { if (Array.isArray(ids) && ids.length) host.toast(t('ai.visionMissing'), { kind: 'warn' }); return false; }
        const ok = await host.confirm({ title: t('ai.tool.vision'), text: t('ai.visionConsent', { kb: host.visionKb(list) }), ok: t('ai.visionSend') });
        if (!ok) return false;
        host.openAi();
        for (const x of list) visionAgreed.add(x);
        try { return await run('vision', { ids: list }); } finally { visionAgreed.clear(); }
      }

      // 「AIが決めた固定 n [すべて自動に戻す]」: every pin by 'ai', one undo step.
      function clearAiPins() {
        if (!aiPinCount(host.doc)) return false;
        host.batch({ label: ['undo.unpinAi', {}] }, [{ t: 'pin.clearUnder', scope: 'work', by: 'ai' }]);
        return true;
      }

      return {
        get state() { return state; },
        on, setProvider, setModel, setKey, setRemember, forgetKey, forgetKeys, checkKey, blocked, songBlocked, hasConsent, consent, setAllowMedia,
        visionBlocked, describeMedia,
        run, abort, dismiss, toggle, toggleAgg, toggleAll, setTranscriptTimes, apply, applyTranscript, discard, tryOn, endTryOn,
        tryOnReplaced, strip, docChanged, projectChanged, revert, clearAiPins, logEntries,
        keyPrefix: () => KEY_PREFIX[state.provider] || '',
        hasDirect: () => !!DIRECT,
        hasRecipe: () => !!RECIPE,
        hasVision: () => !!VISION,
      };
    }

    return {
      TOOLS, SONG_TOOLS, GROUP_ORDER, AREA_GROUP_ORDER, DIRECT_ORDER, STAGES, GUIDE_TOPICS, MAX_INSTRUCTION, MAX_BRIEFS,
      ASK_MAX, ASKS_CAP, LOG_CAP, KEY_PREFIX, SETTINGS_KEY,
      readSettings, createKeyStore, keyStatus, statusOfError, costText, consentFacts, selectedLines, mediaOnDevice, withChecked, withAll,
      grouped, counts, withLog, revertable, changeGroups, revertTally, aiPinCount, changesOf, letter, createController,
      targetRef, groupOfChange, directGroups, aggRows, aggState, isDisabled, withToggle, withAggToggle, withAsk,
      boardBriefs, refOfKey, itemKey,
    };
  });
