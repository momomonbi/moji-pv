/* 文字PVメーカー v2 — original work. Photos and videos: the import flows (drop, paste, menu, library, picker), placing an asset, the library's commands, relink, colour matching and the file progress rows (DESIGN_2_1 §11.7.2, §11.7.3, §11.6.3, §12.7). */
MV.def('ui/media_io', ['ui/dom', 'core/media', 'core/color', 'i18n/t', 'ui/selection', 'ui/fields', 'ui/project_io',
  'ui/output', 'planner/areas', 'media/host/probe', 'media/palette', 'media/samples'],
(dom, MEDIA, C, T, S, F, PIO, OUT, AREAS, PR, PAL, SM) => {
  'use strict';

  // Using an asset means choosing a part and pinning its media param (§11.1.2). The four uses and their parts:
  const USES = Object.freeze({
    ground: Object.freeze({ slot: 'ground', kind: 'ground', key: 'photoPan', param: 'image' }),
    frame: Object.freeze({ slot: 'ornament', kind: 'ornament', key: 'photoFrame', param: 'src' }),
    fill: Object.freeze({ slot: 'ornament', kind: 'ornament', key: 'textFill', param: 'src' }),
    overlay: Object.freeze({ slot: 'atmos', kind: 'ornament', key: 'mediaLayer', param: 'src' }),
  });
  const USE_OF_KEY = Object.freeze({ photoPan: 'ground', photoFrame: 'frame', textFill: 'fill', mediaLayer: 'overlay' });
  const PROGRESS_ANNOUNCE_MS = 5000;         // §11.7.10: import progress is announced at most once every 5 s
  const COLORS_PX = 64;                      // §11.6.3: the still is read at 64×64
  const DUR_MATCH = 0.05;                    // §11.2.9: a relink candidate video lasts as long, ±0.05 s
  const ACCEPT = 'image/*,video/*,.png,.jpg,.jpeg,.webp,.avif,.gif,.svg,.mp4,.m4v,.mov,.webm,.mkv';
  const HEAVY_FRAMES = 240;                  // §11.4.9: a clip is heavy to export when speed × fps > 240 frames a second
  const VISION_PX = 768;                     // §11.6.2: a picture for 写真の説明 is 768 px on its long side, JPEG 0.8
  const VISION_Q = 0.8;
  const VISION_AT = Object.freeze([0.1, 0.5, 0.9]);   // a video: frames at 10 %, 50 % and 90 % of the range it is used in
  const JPEG_BYTES_PER_PX = 0.2;             // about what a JPEG at quality 0.8 takes, for the consent's 約{kb}KB

  // --- pure helpers (Node-tested) ------------------------------------------------------------------------------------

  function isTimed(entry) { return !!entry && (entry.kind === 'video' || entry.anim === true); }

  // fitsAccept('image' | 'video' | 'any', entry): a video param takes videos and animations, an image param stills.
  function fitsAccept(accept, entry) {
    if (!entry) return false;
    if (accept === 'image') return !isTimed(entry);
    if (accept === 'video') return isTimed(entry);
    return true;
  }

  // pastedFiles(clipboardData) → the image and video files a paste carries (§11.7.2; ui/boot's paste listener).
  function pastedFiles(data) {
    return data && data.files ? [...data.files].filter((f) => /^(image|video)\//.test(f.type || '')) : [];
  }

  // The library of a document ([] for one loaded without it, e.g. a test harness's raw document).
  function libraryOf(doc) { return doc && doc.media && Array.isArray(doc.media.list) ? doc.media.list : []; }

  function entryOf(doc, id) { return libraryOf(doc).find((e) => e.id === id) || null; }

  // where(sel, plan, doc) → { kind: 'work' | 'lines' | 'cut', scopes, lineIds, area }: the scope a placement pins at
  // (§11.7.2): 作品全体 when nothing, the root or a work page is selected; every selected line (a multi-line or area
  // selection); the selected cut; an element page's own scope.
  function whereOf(sel, plan, doc) {
    const s = S.validate(sel, plan, doc);
    if (s.level === 'line') return { kind: 'lines', scopes: s.ids.map((id) => 'line/' + id), lineIds: s.ids.slice(), area: s.area || null };
    const scope = S.scopeOf(s, plan);
    if (scope === 'work') return { kind: 'work', scopes: ['work'], lineIds: [], area: null };
    if (scope.startsWith('line/')) return { kind: 'lines', scopes: [scope], lineIds: [scope.slice(5)], area: null };
    return { kind: 'cut', scopes: [scope], lineIds: [], area: null };
  }

  // scopeWords(t, where, doc, plan) → the words for a placement's scope: 作品全体 / 3行目 / サビ1 / 3–5行 / 3行目のカット2
  // (one line is 「3行目」, never 「3行」, which reads as a count).
  function scopeWords(t, w, doc, plan) {
    if (!w || w.kind === 'work') return t('area.work');
    const lineNo = (id) => { const l = plan ? plan.lines.find((x) => x.id === id) : null; return t('aim.line', { n: l ? l.index + 1 : '?' }); };
    if (w.kind === 'lines') {
      if (w.area) { const a = AREAS.resolve(doc, plan, w.area); if (a) return F.areaLabel(t, a); }
      if (w.lineIds.length === 1) return lineNo(w.lineIds[0]);
      const a = AREAS.resolve(doc, plan, AREAS.ofLines(doc, plan, w.lineIds));
      return a ? F.areaLabel(t, a) : t('count.lines', { n: w.lineIds.length });
    }
    const key = w.scopes[0].slice(4);
    const cr = S.crumbs({ level: 'cut', key }, plan).slice(1).map((c) => t.label(c.label));
    const cut = plan ? plan.cuts.find((c) => c.key === key) : null;
    if (cut && cut.line && cr.length > 1) return t('why.lineCut', { line: lineNo(cut.line), cut: cr[cr.length - 1] });
    return cr[cr.length - 1] || t('pb.scope.cut');
  }

  // freeIndex(doc, plan, scope, kind): the first ornament#i no user or lock pin holds (the §5.5 rule; ui/fields).
  const freeIndex = (doc, plan, scope, kind) => F.freeIndex(doc, plan, scope, kind);

  // placeCmds(doc, plan, id, use, scopes, pinSig) → { cmds, full: [scope] }: the pins that show the asset as `use` at
  // every scope, one pair each (the part and its media param, §11.7.2); ornaments take the first free index (full:
  // the scopes without one). Cut paths are written where the cut's pins live, with its text as sig (ui/fields.pinCmd).
  function placeCmds(doc, plan, id, use, scopes, pinSig) {
    const u = USES[use];
    if (!u) throw new Error('ui/media_io: unknown use ' + use);
    const cmds = [], full = [];
    for (const scope of scopes) {
      let slot = u.slot;
      if (slot === 'ornament') {
        const i = freeIndex(doc, plan, scope, 'ornament');
        if (i === null) { full.push(scope); continue; }
        slot = 'ornament#' + i;
      }
      cmds.push(F.pinCmd(scope + ':' + slot, u.key, plan, pinSig), F.pinCmd(scope + ':' + slot + '@' + u.key + '.' + u.param, id, plan, pinSig));
    }
    return { cmds, full };
  }

  // The names of the params of type media of a part (photoPan: ['image']; the derived myMed grounds too).
  function mediaParamsOf(registry, kind, key) {
    let list = null;
    try { list = registry && typeof registry.params === 'function' ? registry.params(kind, key) : null; } catch (e) { list = null; }
    return (list || []).filter((p) => p.spec && p.spec.type === 'media').map((p) => p.name);
  }

  const kindOfSlot = (slot) => (slot === 'ground' ? 'ground' : 'ornament');

  // The part pins (…:ground = photoPan) whose every media param loses its value once the pins in `cleared` go: with no
  // picture left they would show nothing, so they go too (§11.2.5 削除). Lock pins stay (Unlock removes them).
  function emptiedPartPins(doc, registry, cleared) {
    const gone = new Set(cleared);
    const out = [];
    for (const path of cleared) {
      const at = path.indexOf(':');
      const m = /^(ground|atmos|ornament#\d)@([A-Za-z0-9]+)\.([A-Za-z0-9]+)$/.exec(path.slice(at + 1));
      if (!m) continue;
      const scope = path.slice(0, at), slot = m[1], key = m[2];
      const partPath = scope + ':' + slot;
      const pin = doc.pins[partPath];
      if (!pin || pin.v !== key || pin.by === 'lock' || out.includes(partPath)) continue;
      const left = mediaParamsOf(registry, kindOfSlot(slot), key).some((name) => {
        const p = scope + ':' + slot + '@' + key + '.' + name;
        return !gone.has(p) && doc.pins[p] && MEDIA.isId(doc.pins[p].v);
      });
      if (!left) out.push(partPath);
    }
    return out;
  }

  // deleteCmds(doc, registry, id) → one batch (§11.2.5): media.remove (its pins, derived keys and avoid items go with it),
  // then pin.clear of every part pin whose media param has become empty.
  function deleteCmds(doc, registry, id) {
    const refs = MEDIA.refsOf(doc, id).pins.filter((p) => doc.pins[p].v === id);
    return [{ t: 'media.remove', id }].concat(emptiedPartPins(doc, registry, refs).map((path) => ({ t: 'pin.clear', path })));
  }

  // notUseCmds(doc, registry, id) → この写真を使わない: every pin that uses the asset is cleared (an avoid list only loses
  // its item), the emptied part pins with them, and おまかせ stops using it. The library keeps the asset.
  function notUseCmds(doc, registry, id) {
    const key = MEDIA.keyOf(id);
    const cmds = [];
    const cleared = [];
    for (const path of MEDIA.refsOf(doc, id).pins) {
      const pin = doc.pins[path];
      if (pin.by === 'lock') continue;
      if (Array.isArray(pin.v)) {
        const rest = pin.v.filter((x) => !(typeof x === 'string' && x.slice(x.indexOf('.') + 1) === key));
        cmds.push(rest.length ? { t: 'pin.set', path, v: rest, by: pin.by } : { t: 'pin.clear', path });
      } else {
        cmds.push({ t: 'pin.clear', path });
        cleared.push(path);
      }
    }
    for (const path of emptiedPartPins(doc, registry, cleared)) if (!cleared.includes(path)) cmds.push({ t: 'pin.clear', path });
    const e = entryOf(doc, id);
    if (e && e.pool) cmds.push({ t: 'media.meta', id, pool: false });
    return cmds;
  }

  // usePlaces(doc, plan, id) → [{ use, scope, sel, lineIds, area? }]: where the asset shows (§11.7.3 使っている場所), one
  // place per scope and use; the lines of one use together when they form an area (「サビ1（枠）」). Materials follow as
  // { use: 'material', id }.
  function usePlaces(doc, plan, id) {
    const key = MEDIA.keyOf(id);
    const found = [];
    for (const path of MEDIA.refsOf(doc, id).pins) {
      const pin = doc.pins[path];
      const at = path.indexOf(':');
      const scope = path.slice(0, at), slot = path.slice(at + 1);
      let use = null, el = null, idx = null;
      const m = /^(ground|atmos|ornament#(\d))@([A-Za-z0-9]+)\.[A-Za-z0-9]+$/.exec(slot);
      if (m && pin.v === id) {
        use = USE_OF_KEY[m[3]] || (m[1] === 'ground' ? 'ground' : m[1] === 'atmos' ? 'overlay' : 'frame');
        el = m[1] === 'ground' || m[1] === 'atmos' ? 'ground' : 'ornament';
        idx = m[2] !== undefined ? Number(m[2]) : null;
      } else if (slot === 'ground' && pin.v === key) { use = 'ground'; el = 'ground'; }
      if (!use || found.some((f) => f.scope === scope && f.use === use)) continue;
      found.push({ use, scope, el, idx });
    }
    const out = [];
    for (const use of ['ground', 'frame', 'fill', 'overlay']) {
      const mine = found.filter((f) => f.use === use);
      const lines = mine.filter((f) => f.scope.startsWith('line/')).map((f) => f.scope.slice(5));
      let grouped = false;
      if (lines.length > 1 && plan) {
        const ref = AREAS.ofLines(doc, plan, lines);
        const area = AREAS.resolve(doc, plan, ref);
        if (area) { out.push({ use, scope: null, sel: S.areaSel(area), lineIds: lines, area }); grouped = true; }
      }
      for (const f of mine) {
        if (grouped && f.scope.startsWith('line/')) continue;
        const sel = Object.assign({ level: 'el', scope: f.scope, el: f.el }, f.idx !== null ? { idx: f.idx } : {});
        out.push({ use, scope: f.scope, sel, lineIds: f.scope.startsWith('line/') ? [f.scope.slice(5)] : [], area: null });
      }
    }
    out.sort((a, b) => rank(a) - rank(b));
    for (const mid of MEDIA.refsOf(doc, id).materials) out.push({ use: 'material', id: mid, scope: null, sel: null, lineIds: [], area: null });
    return out;
  }
  const rank = (p) => (p.scope === 'work' ? 0 : p.area ? 1 : p.scope && p.scope.startsWith('line/') ? 2 : 3);

  // The library's move (上へ / 下へ): media.move's `before` for one step up or down; undefined at the end it cannot pass.
  function moveCmd(doc, id, dir) {
    const list = libraryOf(doc);
    const i = list.findIndex((e) => e.id === id);
    if (i < 0) return undefined;
    if (dir < 0) return i === 0 ? undefined : { t: 'media.move', id, before: list[i - 1].id };
    if (i >= list.length - 1) return undefined;
    return { t: 'media.move', id, before: i + 2 < list.length ? list[i + 2].id : null };
  }

  // relinkCandidate(missing, entry) → the missing entry a different file may stand in for (§11.2.9): the same kind, and
  // the same displayed size (images) or the same duration ±0.05 s (videos and animations); null when none fits.
  function relinkCandidate(missing, entry) {
    for (const m of missing) {
      if (m.kind !== entry.kind || !!m.anim !== !!entry.anim || m.id === entry.id) continue;
      if (isTimed(m) ? Math.abs((m.dur || 0) - (entry.dur || 0)) <= DUR_MATCH : m.w === entry.w && m.h === entry.h) return m;
    }
    return null;
  }

  // Saturation of a colour (HSV), for colour matching.
  function saturation(hex) {
    const c = C.parse(hex);
    const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b);
    return max === 0 ? 0 : (max - min) / max;
  }

  // matchColors(colors, ground) → { accent, shiftA, shiftB } | null (§11.6.3): the accent is the most saturated colour,
  // moved to contrast ≥ 3:1 against the ground (core/color.fitContrast); shiftA and shiftB the next two by weight.
  function matchColors(colors, ground) {
    const list = (colors || []).filter(C.isHex).map((x) => x.toUpperCase());
    if (!list.length) return null;
    let best = list[0];
    for (const c of list) if (saturation(c) > saturation(best)) best = c;
    const rest = list.filter((c) => c !== best);
    const out = { accent: C.isHex(ground) ? C.fitContrast(best, ground, 3).toUpperCase() : best };
    if (rest[0]) out.shiftA = rest[0];
    if (rest[1]) out.shiftB = rest[1];
    return out;
  }

  // Seconds as 0:12 (the library) or 0:12.5 (the asset page).
  function durText(sec, tenths) {
    const x = Math.max(0, Number(sec) || 0);
    const m = Math.floor(x / 60);
    const s = tenths ? (Math.floor((x - m * 60) * 10) / 10).toFixed(1).padStart(4, '0') : String(Math.floor(x - m * 60)).padStart(2, '0');
    return m + ':' + s;
  }

  // The kind word's key: 写真 / 動画 / アニメ.
  function kindKey(entry) { return entry.kind === 'video' ? 'media.kind.video' : entry.anim ? 'media.kind.anim' : 'media.kind.image'; }

  // The badges of §11.2.8 (and the kind notes of §11.7.5): keys of media.badge.*.
  function badgesOf(entry, stats) {
    const out = [];
    if (entry.alpha) out.push('alpha');
    if (entry.mime === 'image/gif') out.push('gif');
    if (typeof entry.codec === 'string' && /^(hvc1|hev1)/.test(entry.codec)) out.push('hevc');
    if (entry.hdr) out.push('hdr');
    if (stats && stats.gopMean > MEDIA.LIMITS.gopSlow) out.push('gop');
    return out;
  }

  // The library line's facts: 「動画 0:12 · 1920×1080」, 「写真 透明 · 800×800」; bare leaves the kind word out (the row's
  // accessible name says the kind once).
  function infoText(t, entry, bare) {
    const size = entry.w + '×' + entry.h;
    const head = bare ? [] : [t(kindKey(entry))];
    if (isTimed(entry)) head.push(durText(entry.dur));
    if (entry.alpha) head.push(t('media.badge.alpha'));
    return head.length ? head.join(' ') + ' · ' + size : size;
  }

  function libraryBytes(doc) {
    return ((doc && doc.media && doc.media.list) || []).reduce((n, e) => n + (e.bytes || 0), 0);
  }

  // visionSize(w, h) → { w, h }: the size a picture is sent at (the long side 768 px at most, never enlarged).
  function visionSize(w, h) {
    const k = Math.min(1, VISION_PX / Math.max(1, w, h));
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }

  // The estimated size of one sent picture in KB (the consent names it before anything is encoded).
  function visionKb(entries) {
    let px = 0;
    for (const e of entries) { const s = visionSize(e.w, e.h); px = Math.max(px, s.w * s.h); }
    return Math.max(1, Math.round(px * JPEG_BYTES_PER_PX / 1024));
  }

  // usedRange(plan, id, dur) → { a, b }: the source range an asset is shown in, from the first decision that shows it
  // (clipIn…clipOut, clipOut 0 meaning the end), else the whole clip; 写真の説明 sends frames from it.
  function usedRange(plan, id, dur) {
    let p = null;
    const look = (d) => { if (!p && d && d.p && Object.values(d.p).includes(id)) p = d.p; };
    for (const g of (plan && plan.grounds) || []) if (g) { look(g.ground); look(g.atmos); }
    for (const c of (plan && plan.cuts) || []) for (const [slot, d] of Object.entries(c.slots || {})) if (slot.startsWith('ornament#')) look(d);
    const d = Math.max(0, Number(dur) || 0);
    const a = Math.max(0, Math.min(d, p ? Number(p.clipIn) || 0 : 0));
    const out = p ? Number(p.clipOut) || 0 : 0;
    return { a, b: out > a ? Math.min(out, d) : d };
  }

  // The part decisions of a plan that show an asset: { slot: 'ground' | 'atmos' | 'ornament#i', id, speed }.
  function mediaUses(plan) {
    const out = [];
    const pm = plan && plan.media ? plan.media : {};
    const scan = (slot, d) => {
      if (!d || !d.p) return;
      for (const v of Object.values(d.p)) if (MEDIA.isId(v) && pm[v]) out.push({ slot, id: v, speed: typeof d.p.speed === 'number' ? d.p.speed : 1 });
    };
    for (const g of (plan && plan.grounds) || []) { if (g) { scan('ground', g.ground); scan('atmos', g.atmos); } }
    for (const c of (plan && plan.cuts) || []) for (const [slot, d] of Object.entries(c.slots || {})) if (slot.startsWith('ornament#')) scan(slot, d);
    return out;
  }

  // preflight(doc, plan, stateOf) → step ④'s media items (§11.7.8, §11.7.9): media-missing (block; [つなぎ直す] opens
  // the library) per asset not on this device; media-skipped (info) when the backdrop the export renders
  // (ui/output.effectiveBackdrop) leaves out a background or overlay medium; media-hdr (info) per HDR video;
  // media-heavy (info) per video whose speed × fps exceeds 240 (§11.4.9). Missing and HDR read every asset the plan
  // draws (plan.media: decision params and materials alike).
  function preflight(doc, plan, stateOf) {
    const uses = mediaUses(plan);
    const items = [];
    const pm = plan.media || {};
    const ids = Object.keys(pm);
    const nameOf = (id) => { const e = entryOf(doc, id); return e ? e.name : '—'; };
    for (const id of ids) {
      if (stateOf(id) === 'missing') items.push({ code: 'media-missing', level: 'block', params: { name: nameOf(id) }, jump: { action: 'media.library' } });
    }
    const bg = OUT.effectiveBackdrop(doc);
    if (bg && bg !== 'scene' && uses.some((u) => u.slot === 'ground' || u.slot === 'atmos')) items.push({ code: 'media-skipped', level: 'info', params: { bg } });
    for (const id of ids) { const e = entryOf(doc, id); if (e && e.hdr) items.push({ code: 'media-hdr', level: 'info', params: { name: e.name } }); }
    const heavy = new Map();
    for (const u of uses) {
      const m = pm[u.id];
      if (!isTimed(m) || !(m.fps > 0) || u.speed * m.fps <= HEAVY_FRAMES) continue;
      heavy.set(u.id, Math.max(heavy.get(u.id) || 0, u.speed));
    }
    for (const [id, speed] of heavy) items.push({ code: 'media-heavy', level: 'info', params: { s: speed, name: nameOf(id) } });
    return items;
  }

  // --- the host part --------------------------------------------------------------------------------------------------

  function mount(app) {
    const t = app.t;
    const queue = [];                   // files waiting: { file, batch }
    let current = null;                 // { file, abort, p }
    let progress = null;                // the sticky toast row of the imports (null while none is shown)
    let announced = 0;                  // when the live region last heard the import progress
    let generation = 0;                 // one per loaded work: an import started in another work is dropped
    let lastSel = null;                 // the latest line / cut selection since the work was loaded (選択中 on the asset page)
    const posters = new Map();          // id → { p, value }
    const strips = new Map();
    const colors = new Map();
    let warnedStorage = false, warnedBig = false;

    const assets = () => app.assets || null;
    const doc = () => app.doc;
    const plan = () => app.plan;
    const entry = (id) => entryOf(doc(), id);
    const device = () => (app.io ? app.io.device : null);
    // An asset an import, relink or replace stored (res.fresh) that does not join the work: other tabs may prune it again
    // (an import dropped for another work needs nothing: that load let go of what the new work does not name).
    const drop = (res) => { if (res.fresh && app.io && typeof app.io.releaseMedia === 'function') app.io.releaseMedia(res.entry.id); };
    const canvas = () => (app.svc && app.svc.canvas ? app.svc.canvas : null);

    // state(id) → 'ok' | 'missing' | 'loading' | 'error' (the AssetStore's view of the bytes on this device)
    function state(id) {
      const a = assets();
      const info = a && typeof a.info === 'function' ? a.info(id) : null;
      return info ? info.state : 'loading';
    }

    // --- where a placement goes, and its name ----------------------------------------------------------------------------

    function where() { return whereOf(app.view.state.sel, plan(), doc()); }

    // The selection 選択中 means on the asset page: the current one, or the latest line or cut selection while the
    // library (作品全体) is shown; null when there is none.
    function placeSel() {
      const s = S.validate(app.view.state.sel, plan(), doc());
      if (s.level !== 'work') return s;
      if (!lastSel) return null;
      const again = S.validate(lastSel, plan(), doc());
      return again.level === 'work' ? null : again;
    }

    function scopeText(w) { return scopeWords(t, w, doc(), plan()); }

    // place(id, use, w?) → true when pinned: one batch (§11.7.3 placement buttons), labelled 「写真・動画を使う（{scope}）」.
    function place(id, use, w, extra) {
      const at = w || where();
      const { cmds, full } = placeCmds(doc(), plan(), id, use, at.scopes, app.svc.pinSig);
      if (full.length) app.toast(t('media.noSlot'), { kind: 'warn' });
      if (!cmds.length) return false;
      const scope = scopeText(at);
      app.batch({ label: ['undo.media.place', { scope }] }, (extra || []).concat(cmds));
      return true;
    }

    // --- imports (§11.7.2, §11.4.13) --------------------------------------------------------------------------------------

    function codeText(e, file) {
      const code = e && e.code && t.has('media.err.' + e.code) ? e.code : 'broken';
      return t('media.err.' + code, { name: file.name, codec: e && e.detail && e.detail.codec ? e.detail.codec : '?' });
    }

    function progressText() {
      if (!current) return '';
      const base = t('media.progress', { name: current.file.name, p: Math.round(current.p * 100) });
      const left = queue.filter((j) => !j.batch.stopped).length;
      return left ? base + t('media.queue', { n: left }) : base;
    }

    // The progress row (§11.7.2): made when a file starts (again after the user closed it with ×), updated in place
    // while it reads; the live region hears it at most once every 5 s (§11.7.10).
    function showProgress(start) {
      if (!current) return;
      const text = progressText();
      const now = Date.now();
      const announce = now - announced >= PROGRESS_ANNOUNCE_MS;
      if (announce) announced = now;
      if (progress) { progress.update(text, { announce }); return; }
      if (!start) return;
      progress = app.toast(text, { kind: 'info', sticky: true, quiet: !announce, action: { label: t('media.cancel'), run: () => cancel() },
        onClose: () => { progress = null; } }) || null;
    }

    function closeProgress() { if (progress) { progress.close(); progress = null; } }

    // [中止]: the file being read and every file waiting; each batch ends with what it already has.
    function cancel() {
      for (const job of queue) job.batch.stopped = true;
      if (current) { current.batch.stopped = true; current.abort.abort(); }
      closeProgress();
    }

    // importFiles(files, { target: 'stage' | 'song' | null, onPicked(entry) → false when declined }) → Promise<[entry]>:
    // every file in turn through media/host/probe.importFile (one at a time, each cancellable); a new asset is added
    // with media.put. Dropped on the stage, the first photo or video becomes the background of the current scope in the
    // same undo step; dropped on step ②'s song box, a video's sound becomes the song. Files still reading when another
    // work is loaded are dropped (their pins would name lines of the other work).
    function importFiles(files, opts) {
      const list = [...(files || [])];
      if (!list.length) return Promise.resolve([]);
      return new Promise((resolve) => {
        const batch = { opts: opts || {}, left: list.length, entries: [], all: [], placed: false, audio: null, resolve, w: where(),
          gen: generation, stopped: false, declined: false };
        for (const file of list) queue.push({ file, batch });
        pump();
      });
    }

    let pumping = false;
    async function pump() {
      if (pumping) return;
      pumping = true;
      try {
        while (queue.length) {
          const job = queue.shift();
          if (!job.batch.stopped && job.batch.gen === generation) {
            current = { file: job.file, abort: new AbortController(), p: 0, batch: job.batch };
            showProgress(true);
            try { await importOne(job); } catch (e) { if (typeof console !== 'undefined') console.error(e); }
            current = null;
          }
          job.batch.left--;
          if (!job.batch.left) finish(job.batch);
        }
      } finally {
        current = null;
        pumping = false;
        closeProgress();
      }
    }

    // この動画の音を曲にする in a toast: on step ② for a video with sound (§11.7.2).
    function audioActs(e) {
      return e && e.audio && app.view.state.step === 'song' ? [{ label: t('media.useAudio'), run: () => useAudio(e.id) }] : [];
    }

    // [元に戻す] of a toast that reports the step just made (§11.7.2): it undoes that step while it is still the newest.
    // After other edits it would undo one of those instead, so it says so (the toast of step ② stays until closed).
    function undoLast() {
      const newest = () => { const done = app.store.list().filter((x) => x.done); return done.length ? done[done.length - 1].n : 0; };
      const n = newest();
      return { label: t('cmd.edit.undo'), run: () => {
        if (newest() === n) app.actions.run('edit.undo');
        else if (app.store.list().some((x) => x.n === n && x.done)) app.toast(t('media.undoLater'), { kind: 'info' });
      } };
    }

    async function importOne(job) {
      const { file, batch } = job;
      const job0 = current;
      let res;
      try {
        res = await PR.importFile(file, { name: file.name, store: device(), signal: job0.abort.signal, canvas: canvas(),
          idle: canvas() ? canvas().idle : undefined,
          onProgress: (p) => { job0.p = p; showProgress(false); } });
      } catch (e) {
        if (e && e.name === 'AbortError') { app.toast(t('media.cancelled', { name: file.name })); return; }
        if (e && e.code === 'audioOnly') { if (batch.gen === generation) app.loadSong(file); return; }
        app.toast(codeText(e, file), { kind: 'error' });
        return;
      }
      if (batch.gen !== generation) { app.toast(t('media.cancelled', { name: file.name })); return; }   // another work is open now
      const have = entry(res.entry.id);
      const fresh = !have;
      if (fresh && libraryOf(doc()).length >= MEDIA.LIMITS.library) { drop(res); app.toast(t('media.full'), { kind: 'error' }); return; }
      if (res.notes.includes('quota')) app.toast(t('media.err.quota'), { kind: 'error', action: { label: t('io.saveFile'), run: () => app.io.saveAs() } });
      else if (res.notes.includes('memoryOnly')) app.toast(t('media.warn.memoryOnly'), { kind: 'warn' });
      if (res.notes.includes('bigFile')) app.toast(t('media.warn.bigFile', { size: T.fmtBytes(res.entry.bytes) }), { kind: 'info' });
      if (res.notes.includes('animFirstFrame')) app.toast(t('media.note.animFirstFrame'), { kind: 'info' });
      if (res.notes.includes('alphaIgnored')) app.toast(t('media.note.alphaIgnored'), { kind: 'info' });
      if (assets() && state(res.entry.id) === 'missing') forget(res.entry.id);    // bytes that were not here before
      const put = fresh ? [{ t: 'media.put', entry: res.entry }] : [];
      const e = fresh ? res.entry : have;
      if (e.audio && !batch.audio) batch.audio = e;
      const toSong = batch.opts.target === 'song' && e.audio && batch.audio === e;
      let placed = false;
      if (batch.opts.target === 'stage' && !batch.placed) {
        batch.placed = true;
        placed = place(e.id, 'ground', batch.w, put);
        if (placed) {
          const scope = scopeText(batch.w);
          app.toast(t(e.kind === 'video' ? 'media.placedVideo' : 'media.placed', { scope }), { kind: 'ok', sticky: audioActs(e).length > 0,
            actions: [undoLast(),
              { label: t('media.otherUses'), run: () => openAsset(e.id) }].concat(audioActs(e)) });
        } else if (put.length) app.dispatch(put[0], { label: ['undo.media.put', {}] });
      } else if (put.length) {
        app.dispatch(put[0], { label: ['undo.media.put', {}] });
      }
      if (!fresh && !toSong) {
        const acts = placed ? [] : audioActs(e);
        app.toast(t('media.dup', { name: file.name }), { kind: 'info', sticky: acts.length > 0, actions: acts });
      }
      if (!fresh && batch.opts.target !== 'stage' && !batch.opts.onPicked && !toSong) openAsset(e.id);
      if (fresh) batch.entries.push(e);
      batch.all.push(e);
      if (batch.opts.onPicked && entry(e.id) && batch.opts.onPicked(e) === false) batch.declined = true;
    }

    // After a batch: 「{n}件を読み込みました [使い方を選ぶ]」 (not for a stage drop, which said where it went, nor for a
    // picker that used the file), with [この動画の音を曲にする] on step ② for a video with sound (kept until used or
    // closed), then the storage warnings. Dropped on the song box, a video's sound becomes the song at once. Resolves
    // with every entry the files gave (new or already in the library), in order.
    async function finish(batch) {
      const n = batch.entries.length;
      const here = batch.gen === generation;
      if (here && batch.opts.target === 'song' && batch.audio && entry(batch.audio.id)) {
        useAudio(batch.audio.id);
      } else if (here && n && batch.opts.target !== 'stage' && (!batch.opts.onPicked || batch.declined)) {
        const first = batch.entries[0];
        const acts = [{ label: t('media.chooseUse'), run: () => openAsset(first.id) }].concat(audioActs(batch.audio));
        app.toast(t('media.done', { n }), { kind: 'ok', sticky: acts.length > 1, actions: acts });
      }
      batch.resolve(batch.all.slice());
      if (n && here) await storageWarnings();
    }

    async function storageWarnings() {
      const total = libraryBytes(doc());
      if (!warnedBig && total > MEDIA.LIMITS.warnTotal) {
        warnedBig = true;
        app.toast(t('media.warn.big', { size: T.fmtBytes(total) }), { kind: 'warn' });
      }
      if (warnedStorage || !app.io || typeof app.io.storageInfo !== 'function') return;
      const note = PIO.quotaNote(await app.io.storageInfo());
      if (note) {
        warnedStorage = true;
        app.toast(t('media.warn.storage', { p: Math.round(note.share * 100), size: T.fmtBytes(note.usage) }), { kind: 'warn',
          action: { label: t('io.saveFile'), run: () => app.io.saveAs() } });
      }
    }

    // ＋ 読み込む, ≡ › ファイル › 写真・動画を読み込む…, the picker's ＋ tile: the file picker, then importFiles.
    async function pickAndImport(opts) {
      const files = await dom.pickFiles(ACCEPT, true);
      return files.length ? importFiles(files, opts || {}) : [];
    }

    // --- the library's commands --------------------------------------------------------------------------------------

    function setPool(id, on) { app.dispatch({ t: 'media.meta', id, pool: !!on }, { label: ['undo.media.meta', {}] }); }

    function rename(id, text) {
      const name = Array.from(String(text || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()).slice(0, MEDIA.LIMITS.nameMax).join('');
      const e = entry(id);
      if (!name || !e || name === e.name) return false;
      app.dispatch({ t: 'media.meta', id, name }, { label: ['undo.media.meta', {}] });
      return true;
    }

    function move(id, dir) {
      const cmd = moveCmd(doc(), id, dir);
      if (cmd) app.dispatch(cmd, { label: ['undo.media.move', {}] });
      return !!cmd;
    }

    // 削除: asked first, with how many places go back to their previous look; one batch.
    async function remove(id) {
      const e = entry(id);
      if (!e) return false;
      const n = usePlaces(doc(), plan(), id).length;
      const text = n ? t('media.deleteAsk', { name: e.name }) + '\n' + t('media.deleteNote', { n }) : t('media.deleteAsk', { name: e.name });
      const ok = app.confirm ? await app.confirm({ title: t('media.delete'), text, ok: t('media.delete'), danger: true }) : true;
      if (!ok || !entry(id)) return false;
      app.batch({ label: ['undo.media.remove', {}] }, deleteCmds(doc(), app.reg, id));
      return true;
    }

    function notUse(id) {
      const cmds = notUseCmds(doc(), app.reg, id);
      if (cmds.length) app.batch({ label: ['undo.media.notUse', {}] }, cmds);
      return cmds.length > 0;
    }

    // この動画の音を曲にする (§11.1.1): the video file through the song path (decodeAudioData reads MP4 and WebM sound).
    async function useAudio(id) {
      const e = entry(id);
      const rec = e && app.io ? await app.io.getMedia(id) : null;
      if (!rec || !rec.blob) { app.toast(t('media.missing'), { kind: 'warn' }); return false; }
      app.goStep('song');
      app.loadSong(new File([rec.blob], e.name, { type: rec.mime || e.mime }));
      return true;
    }

    // --- relink and replace (§11.2.9) --------------------------------------------------------------------------------------

    function missingEntries() { return libraryOf(doc()).filter((e) => state(e.id) === 'missing'); }

    // relink(id?) → the files the user picks: one whose content is a missing asset is stored under its id (nothing in
    // the document changes); another of the same kind and size (or length) stands in for one missing entry after asking
    // (media.relink). id limits the candidates to that entry.
    async function relink(id) {
      const files = await dom.pickFiles(ACCEPT, !id);
      let n = 0;
      for (const file of files) if (await relinkFile(file, id || null)) n++;
      return n;
    }

    async function relinkFile(file, only) {
      let res;
      try { res = await PR.importFile(file, { name: file.name, store: device(), canvas: canvas() }); } catch (e) {
        app.toast(codeText(e, file), { kind: 'error' });
        return false;
      }
      const id = res.entry.id;
      // The original file of a missing asset: its bytes are here again. A file of an asset that is already here is not a
      // relink (its caches stay); it goes on like any other file.
      const known = !!entry(id);
      if (known && state(id) === 'missing') {
        forget(id);
        app.toast(t('media.relinked', { name: file.name }), { kind: 'ok' });
        return true;
      }
      const pool = missingEntries().filter((e) => !only || e.id === only);
      const cand = relinkCandidate(pool, res.entry);
      if (!cand) {
        // Not the original file: say so (or that it is in the library already), and offer it as a stand-in for the one
        // missing entry it could replace (置き換える).
        const target = only ? entry(only) : pool.length === 1 ? pool[0] : null;
        // The file stays held while 置き換える is offered; closing the toast lets it go.
        const act = target && target.id !== id && target.kind === res.entry.kind
          ? { label: t('media.useInstead'), run: () => standIn(target.id, res.entry, file.name) } : undefined;
        app.toast(t(known ? 'media.dup' : 'media.relinkNone', { name: file.name }), { kind: 'warn', action: act, sticky: !!act,
          onClose: act ? () => drop(res) : undefined });
        if (!act) drop(res);
        return false;
      }
      const text = t('media.relinkAsk', { kind: t(kindKey(cand)), name: file.name });
      const ok = app.confirm ? await app.confirm({ title: t('media.relink'), text, ok: t('media.relink') }) : true;
      if (!ok) { drop(res); return false; }
      standIn(cand.id, res.entry, file.name);
      return true;
    }

    // Another file takes an asset's place everywhere (media.relink, one undo step).
    function standIn(from, next, name) {
      if (!entry(from)) return false;
      app.dispatch({ t: 'media.relink', from, entry: next }, { label: ['undo.media.relink', {}] });
      forget(from);
      app.toast(t('media.relinked', { name }), { kind: 'ok' });
      return true;
    }

    // 置き換える…: another file of the same kind takes the asset's place everywhere (media.relink, one undo step).
    async function replace(id) {
      const e = entry(id);
      const files = await dom.pickFiles(ACCEPT, false);
      if (!e || !files[0]) return false;
      let res;
      try { res = await PR.importFile(files[0], { name: files[0].name, store: device(), canvas: canvas() }); } catch (err) {
        app.toast(codeText(err, files[0]), { kind: 'error' });
        return false;
      }
      if (res.entry.id === id) { forget(id); return true; }
      if (res.entry.kind !== e.kind) { drop(res); app.toast(t('media.replaceKind'), { kind: 'warn' }); return false; }
      app.dispatch({ t: 'media.relink', from: id, entry: res.entry }, { label: ['undo.media.relink', {}] });
      forget(id);
      return true;
    }

    // --- 写真の説明 (§11.6.2): the pictures sent to Gemini ----------------------------------------------------------------

    // A canvas as base64 JPEG 0.8 (nothing of the file's metadata is sent).
    async function jpegData(c) {
      const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: VISION_Q })).arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    }

    // A decoded picture at 768 px on the long side (never enlarged); rot turns a video frame upright (the frame's w and
    // h are its upright size, as the stage's peek draws it).
    function jpegOf(img, w, h, rot) {
      const s = visionSize(w, h);
      const c = new OffscreenCanvas(s.w, s.h);
      const g = c.getContext('2d');
      const r = rot || 0;
      g.translate(s.w / 2, s.h / 2);
      g.rotate(r * Math.PI / 180);
      const cw = r % 180 ? s.h : s.w, ch = r % 180 ? s.w : s.h;
      g.drawImage(img, -cw / 2, -ch / 2, cw, ch);
      return jpegData(c);
    }

    // A still, decoded upright straight at the size it is sent at; the bitmap is closed at once.
    async function stillJpeg(id, e) {
      const rec = app.io ? await app.io.getMedia(id) : null;
      if (!rec || !rec.blob) return null;
      const s = visionSize(e.w, e.h);
      let img = null;
      try {
        img = await createImageBitmap(rec.blob, { imageOrientation: 'from-image', resizeWidth: s.w, resizeHeight: s.h, resizeQuality: 'high' });
        return await jpegOf(img, img.width, img.height, 0);
      } catch (err) {
        const p = await poster(id);                        // an SVG decodes only through an image element: its poster
        return p ? jpegOf(p, p.width, p.height, 0) : null;
      } finally { if (img) img.close(); }
    }

    // A video or an animation: three frames of the range it is used in (usedRange), at 10 %, 50 % and 90 %, decoded
    // exactly at 768 px by a fork of the AssetStore (the preview's own decoders are not disturbed).
    async function timedJpegs(id, e) {
      const a = assets();
      if (!a || typeof a.fork !== 'function') return [];
      const r = usedRange(plan(), id, e.dur);
      const fork = a.fork({ prefer: 'software' });
      const out = [];
      try {
        for (const at of VISION_AT) {
          const m = r.a + (r.b - r.a) * at;
          await fork.ready([{ id, m }]);
          const f = fork.frame(id, m, { px: VISION_PX, blur: 0, exact: true });
          if (f && f.image) out.push(await jpegOf(f.image, f.w, f.h, f.rot));
        }
      } finally { if (typeof fork.dispose === 'function') fork.dispose(); }
      return out;
    }

    // visionParts(ids) → [{ id, parts: [{ inline_data: { mime_type, data } }] }] for ai/vision: a still as one JPEG, a
    // video or an animation as three frames of the range it is used in, each 768 px on the long side (the size the
    // consent names). An asset not on this device is left out.
    async function visionParts(ids) {
      const out = [];
      for (const id of ids || []) {
        const e = entry(id);
        if (!e || state(id) !== 'ok') continue;
        let data = [];
        try {
          if (isTimed(e)) data = await timedJpegs(id, e);
          else { const one = await stillJpeg(id, e); if (one) data.push(one); }
        } catch (err) { data = []; }
        if (data.length) out.push({ id, parts: data.map((x) => ({ inline_data: { mime_type: 'image/jpeg', data: x } })) });
      }
      return out;
    }

    // --- posters, filmstrips, sample tables and colours (from the device store) --------------------------------------------

    // A cache of what the device store gives for an id. Nothing is kept for an asset that gave nothing (missing or still
    // loading): it is asked again next time, so a relinked asset shows at once.
    function cached(map, id, make) {
      let rec = map.get(id);
      if (!rec) {
        rec = { value: undefined, p: null };
        map.set(id, rec);
        const keep = (v) => {
          rec.value = v && !(Array.isArray(v) && !v.length) ? v : null;
          if (rec.value === null && map.get(id) === rec) map.delete(id);
          return rec.value;
        };
        rec.p = Promise.resolve().then(make).then(keep, () => keep(null));
      }
      return rec;
    }

    // Drops what the caches hold for an id (its bitmaps closed), and the AssetStore's state: after a relink stores new
    // bytes, a replace, a load that finds them missing, or a clear.
    function dropCached(id) {
      for (const map of [posters, strips, colors]) {
        const rec = map.get(id);
        if (!rec) continue;
        map.delete(id);
        const v = rec.value;
        const bmp = v && v.image ? v.image : v;
        if (bmp && typeof bmp.close === 'function') { try { bmp.close(); } catch (e) { /* closed */ } }
      }
    }
    function forget(id) {
      dropCached(id);
      if (assets()) assets().forget(id);
    }

    // poster(id) → Promise<ImageBitmap | null>; posterNow(id) → the bitmap once loaded (else undefined / null).
    function poster(id) {
      return cached(posters, id, () => (device() && state(id) !== 'missing' ? PR.posterOf(id, { store: device(), canvas: canvas() }) : null)).p;
    }
    function posterNow(id) { const r = posters.get(id); return r ? r.value : undefined; }

    // strip(id) → Promise<{ image, tiles } | null>: the 12-frame filmstrip sprite of a video or animation.
    function strip(id) {
      return cached(strips, id, async () => {
        if (!device()) return null;
        const rec = await PR.thumbsOf(id, { store: device(), canvas: canvas() });
        if (!rec || !rec.strip) return null;
        return { image: await createImageBitmap(rec.strip), tiles: rec.tiles || PR.STRIP };
      }).p;
    }

    // The stored sample table of a video or animation (mediaIndex), or null.
    async function indexOf(id) {
      if (!app.io || typeof app.io.getIndex !== 'function') return null;
      try {
        const rec = await app.io.getIndex(id);
        return rec && rec.v === MEDIA.INDEX_V ? SM.fromData(rec.table) : null;
      } catch (e) { return null; }
    }

    // tableOf(id) → Promise<Float64Array | null>: the presentation times of the frames (the trim widget's frame steps).
    async function tableOf(id) {
      const table = await indexOf(id);
      return table ? table.pts.subarray(0, table.n) : null;
    }

    // statsOf(id) → Promise<{ gopMean, gopMax, vfr } | null> (the 位置合わせに時間がかかる badge, §11.2.8).
    async function statsOf(id) {
      const table = await indexOf(id);
      return table ? SM.stats(table) : null;
    }

    // colorsOf(id) → Promise<['#RRGGBB']>: the AI's colours when it described the picture, else media/palette.dominant of
    // the still (or the poster) at 64×64.
    function colorsOf(id) {
      const e = entry(id);
      if (e && e.ai && Array.isArray(e.ai.colors) && e.ai.colors.length) return Promise.resolve(e.ai.colors.slice());
      return cached(colors, id, async () => {
        const img = await poster(id);
        if (!img) return [];
        const c = new OffscreenCanvas(COLORS_PX, COLORS_PX);
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, COLORS_PX, COLORS_PX);
        return PAL.dominant(g.getImageData(0, 0, COLORS_PX, COLORS_PX).data, COLORS_PX, COLORS_PX, { k: 5 });
      }).p.then((v) => v || []);
    }

    // この色に合わせる: accent, shiftA and shiftB as work pins, one batch 「色を写真に合わせる」, then a toast that says what
    // changed, with [元に戻す] only when the batch made a step (the same colours pinned again make none, and the button
    // would then undo an older, unrelated step).
    async function matchColorsOf(id) {
      const list = await colorsOf(id);
      const p = plan();
      const m = matchColors(list, p && p.look ? p.look.palette.ground : null);
      if (!m) return false;
      const cmds = Object.keys(m).map((tok) => ({ t: 'pin.set', path: 'work:color.' + tok, v: m[tok], by: 'user' }));
      const rev = app.store.rev;
      app.batch({ label: ['undo.media.colors', {}] }, cmds);
      app.toast(t('media.colorsMatched'), { kind: 'ok', action: app.store.rev !== rev ? undoLast() : undefined });
      return true;
    }

    // --- pages -----------------------------------------------------------------------------------------------------------

    // 作品全体 › 写真・動画 (the library), and an asset's page on top of it. The focus goes to the library: its first
    // missing row (step ④'s つなぎ直す comes here), else its first row, else ＋ 読み込む.
    function openLibrary() {
      app.select(S.WORK, { from: 'header', open: true });
      if (!app.inspector) return;
      if (app.inspector.clearStack) app.inspector.clearStack();
      app.inspector.openSection('media');
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const box = document.querySelector('[data-mount="inspector"] [data-custom="media"]');
        const to = box ? box.querySelector('.med-row.is-missing') || box.querySelector('.med-row') || box.querySelector('.med-import') : null;
        if (to) dom.focus(to);
      }));
    }
    function openAsset(id) {
      if (!entry(id)) return;
      if (app.view.state.panel !== 'details') app.openPanel('details', 'key');
      if (app.inspector && app.inspector.openAsset) app.inspector.openAsset(id);
    }

    // --- package save / open progress (§12.7) -------------------------------------------------------------------------------

    // fileProgress('save' | 'open', file?) → { signal, onProgress, done }: a toast row with [中止], shown at the first
    // progress; while saving the header reads 「ファイルに保存中… 42%」 (app.fileSaving).
    function fileProgress(kind, file) {
      const abort = new AbortController();
      let row = null;
      let last = 0;
      const show = (text) => {
        const now = Date.now();
        const announce = now - last >= PROGRESS_ANNOUNCE_MS;
        if (announce) last = now;
        if (!row) row = app.toast(text, { kind: 'info', sticky: true, action: { label: t('media.cancel'), run: () => abort.abort() } })
          || { close() {}, update() {} };
        else row.update(text, { announce });
      };
      return {
        signal: abort.signal,
        onProgress(x) {
          if (kind === 'save') {
            const p = Math.round(Math.max(0, Math.min(1, Number(x) || 0)) * 100);
            app.fileSaving = p;
            app.bus.emit('save', 'file');
            show(t('io.savingPkg', { p }));
          } else {
            const o = x || {};
            show(t('io.openingPkg', { name: file ? file.name : '', p: Math.round((o.p || 0) * 100), i: o.i || 0, n: o.n || 0 }));
          }
        },
        done() {
          if (row) row.close();
          if (kind === 'save') { app.fileSaving = null; app.bus.emit('save', 'file'); }
        },
      };
    }

    // --- wiring ------------------------------------------------------------------------------------------------------------

    // A loaded work: its assets' bytes are looked up again (a package or a relink may have stored them since), then
    // has() and info() answer at once (§11.3.6 check).
    function recheck() {
      const a = assets();
      if (!a) return;
      const ids = libraryOf(doc()).map((e) => e.id);
      for (const id of ids) if (a.info(id).state === 'missing') forget(id);
      if (typeof a.check === 'function') a.check(ids).then(() => app.bus.emit('media'), () => {});
    }
    app.bus.on('plan', (e) => {
      if (e && e.kind === 'load') {
        // another work: imports still reading belong to the one before (their pins would name its lines)
        generation++;
        for (const job of queue) job.batch.stopped = true;
        if (current) current.abort.abort();
        closeProgress();
        lastSel = null;
        recheck();
      } else if (e && e.touched && e.touched.media) app.bus.emit('media');
    });
    // ≡ › 設定 › 消す: every asset this tab has seen is forgotten (the work shown now is already the empty one), with its
    // posters, filmstrips and decoded pictures.
    app.bus.on('device', () => {
      const ids = new Set([...(typeof app.knownMedia === 'function' ? app.knownMedia() : []), ...posters.keys(), ...strips.keys(),
        ...colors.keys(), ...libraryOf(doc()).map((e) => e.id)]);
      for (const id of ids) forget(id);
    });
    // A video dropped on step ②'s song box (「曲を選ぶ（ここにドロップも可）」) gives the song its sound (importFiles'
    // target 'song'); ui/project_io's window listener reads the mark after this capture listener.
    document.addEventListener('drop', (ev) => {
      if (!ev.mvTarget && ev.target instanceof Element && ev.target.closest('.song-box')) ev.mvTarget = 'song';
    }, true);
    app.view.on((changed, st) => {
      if (!changed.includes('sel')) return;
      const s = st.sel;
      if (s && s.level && s.level !== 'work') lastSel = s;
    });
    if (assets() && typeof assets().on === 'function') assets().on('state', () => app.bus.emit('media'));

    const def = (id, run, extra) => {
      if (!app.actions.has(id)) app.actions.defineAction(Object.assign({ id, label: 'cmd.' + id, run }, extra || {}));
    };
    def('media.import', () => { pickAndImport({}); });
    def('media.library', () => openLibrary());
    def('media.relink', () => { relink(); }, { enabled: () => libraryOf(doc()).some((e) => state(e.id) === 'missing') });

    recheck();

    return {
      importFiles, pickAndImport, place, placeSel, where, scopeText, state, entry, setPool, rename, move, remove, notUse,
      useAudio, relink, replace, poster, posterNow, strip, tableOf, statsOf, colorsOf, matchColors: matchColorsOf, openLibrary,
      openAsset, fileProgress, missing: missingEntries, busy: () => !!current || queue.length > 0,
      preflight: () => (app.plan ? preflight(doc(), app.plan, state) : []),
      visionParts, visionKb: (ids) => visionKb(ids.map(entry).filter(Boolean)),
    };
  }

  return {
    mount, USES, USE_OF_KEY, isTimed, fitsAccept, pastedFiles, libraryOf, entryOf, whereOf, scopeWords, freeIndex, placeCmds, mediaParamsOf, emptiedPartPins,
    deleteCmds, notUseCmds, usePlaces, moveCmd, relinkCandidate, matchColors, saturation, durText, kindKey, badgesOf,
    infoText, libraryBytes, mediaUses, preflight, visionSize, visionKb, usedRange, ACCEPT,
  };
});
