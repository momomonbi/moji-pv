/* 文字PVメーカー v2 — original work. The direct tool (指示): area instructions → requests, the portable answer schema, answer → checked changes (DESIGN_2_1 §5.2–§5.6, §5.11, §11.6.1, §11.9.4). */
MV.def('ai/direct', ['core/pins', 'core/paths', 'core/curve', 'core/shot', 'core/schema', 'core/media', 'planner/areas',
  'planner/plan', 'engine/scene/frame', 'ai/catalog', 'ai/changes', 'ai/looks', 'ai/recipe', 'i18n/t', 'i18n/strings'],
  (PINS, P, CV, SHOT, S, MEDIA, AREAS, PL, FR, CAT, CH, LOOKS, RECIPE, I18N, STRINGS) => {
  'use strict';

  // One tool for every area instruction: the instruction box (one brief), the 区画ごと board (up to 8 briefs) and
  // 「カメラワークをAIに任せる」 (mode 'camera'). Lines are numbered per brief (i) and per line (j), so an answer can only
  // name what was sent; the changes it gives are ordinary pins by 'ai' (and new materials), each checked against its
  // area, reviewed as one list and applied as one undo step (ai/changes).

  const MAX_BRIEFS = 8;
  const MAX_INSTRUCTION = 300;
  const MAX_LINES = 200;
  const LH = LOOKS.helpers;

  const PART_FIELDS = Object.freeze(['arrange', 'arrive', 'dwell', 'depart', 'lens']);
  const CUT_PART_FIELDS = Object.freeze(['arrange', 'arrive', 'depart', 'lens']);
  const CURVE_FIELDS = Object.freeze({ arriveCurve: 'arrive.ease', departCurve: 'depart.ease', flow: 'arrive.flow', lensCurve: 'lens.curve' });
  const LINE_SEASONS = Object.freeze(['any', 'none', 'spring', 'summer', 'autumn', 'winter']);
  const SPECS = Object.freeze({                    // the ranges of planner/camera.SLOT_SPECS (§3.9)
    'motion.speed': Object.freeze({ type: 'num', min: 0.25, max: 4, step: 0.05 }),
    'cam.zoom': Object.freeze({ type: 'num', min: 0.5, max: 2, step: 0.01 }),
    'cam.follow': Object.freeze({ type: 'num', min: 0, max: 1, step: 0.01 }),
  });
  const SPEED_EPS = 0.02;
  const AMOUNT_EPS = 0.01;
  const EMPTY_AT = Object.freeze({ cutKey: null, pinCutKey: null, lineId: null });
  // The review field of a slot: a string key, or [key, kind] for a setting of one kind ('緩急 · 入り').
  const FIELDS = Object.freeze({
    'motion.speed': 'fld.motionSpeed', 'cam.shot': 'fld.camShot', 'cam.zoom': 'fld.camZoom', 'cam.curve': 'fld.camCurve',
    'cam.follow': 'fld.camFollow', rig: 'fld.rig', 'rig.curve': 'fld.rigCurve', season: 'fld.lineSeason', avoid: 'fld.avoid',
    'arrive.ease': ['fld.speedCurve', 'arrive'], 'depart.ease': ['fld.speedCurve', 'depart'], 'arrive.flow': 'fld.flow',
    'lens.curve': 'fld.lensCurve', 'ornament.count': ['fld.count', 'ornament'], 'filter.count': ['fld.count', 'filter'],
    atmos: 'fld.atmos',
  });
  const MEDIA_FIELDS = Object.freeze({ image: 'fld.media', src: 'fld.media', fit: 'fld.fit', blur: 'fld.blur', veil: 'fld.veil',
    clipIn: 'fld.trim', speed: 'fld.speed', depth: 'param.depth' });
  // Where the direct tool puts an asset (§11.6.1): the part, its slot and its media param.
  const MEDIA_USES = Object.freeze({
    ground: Object.freeze({ slot: 'ground', kind: 'ground', key: 'photoPan', param: 'image' }),
    frame: Object.freeze({ slot: 'ornament', kind: 'ornament', key: 'photoFrame', param: 'src' }),
    fill: Object.freeze({ slot: 'ornament', kind: 'ornament', key: 'textFill', param: 'src' }),
    overlay: Object.freeze({ slot: 'atmos', kind: 'ornament', key: 'mediaLayer', param: 'src' }),
  });
  const MEDIA_PARTS = Object.freeze(['photoPan', 'photoFrame', 'textFill', 'mediaLayer']);
  const DERIVED_MEDIA = /^myMed[0-9a-f]{10}$/;            // a pooled asset's derived ground (§11.5.9)
  const MAT_PREFIX = 'mat:';

  // ---- schemas (§5.4, FROZEN; §11.6.1 media variant) ---------------------------------------------------------------

  const STR = { type: 'string' }, NUM = { type: 'number' }, INT = { type: 'integer' }, BOOL = { type: 'boolean' };
  const STRS = { type: 'array', items: STR };
  const closed = (props) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
  const arr = (items) => ({ type: 'array', items });
  const en = (list) => ({ type: 'string', enum: list.slice() });

  const CURVE_AI = RECIPE.CURVE_AI;               // name: '' keep | 'ramp' | a curve preset | an ease name
  const SEASON_AI = RECIPE.SEASON_AI;
  const CAMERA_AI = closed({ shot: STR, move: en(SHOT.MOVES), focus: en(SHOT.FOCI), timing: en(SHOT.TIMINGS), fill: NUM,
    closer: NUM, follow: NUM, curve: CURVE_AI });
  // use: '' keep | 'none' (remove media the AI placed in the area) | 'asset:<n>'; blur, veil, from, speed: −1 keep;
  // depth (§11.9.4): 'keep', or how the media takes part in the animation (the placed one, or with use '' the one the
  // area shows as `as`)
  const MEDIA_AI = closed({ use: STR, as: en(Object.keys(MEDIA_USES)), fit: en([''].concat(MEDIA.FITS)), blur: NUM, veil: NUM,
    from: NUM, speed: NUM, depth: en(['keep'].concat(MEDIA.DEPTHS)) });
  const WORK_AMOUNTS = Object.freeze(LOOKS.AI_AMOUNTS.concat(['camera']));

  function editProps(media) {
    return Object.assign({
      arrange: STR, arrive: STR, dwell: STR, depart: STR, lens: STR, ground: STR, atmos: STR,
      ornaments: STRS, filters: STRS, avoid: STRS, season: SEASON_AI, speed: NUM,
      arriveCurve: CURVE_AI, departCurve: CURVE_AI, flow: CURVE_AI, lensCurve: CURVE_AI,
      camera: CAMERA_AI, impact: en(['keep', 'on', 'off']), emphasis: STRS,
    }, media ? { media: MEDIA_AI } : {});
  }

  function answerSchema(media) {
    const props = editProps(media);
    return closed({
      s: INT, understood: BOOL, summary: STR, question: STR,
      all: closed(Object.assign({ rig: STR, rigCurve: CURVE_AI }, props)),
      lines: arr(closed(Object.assign({ i: INT }, props))),
      cuts: arr(closed({ i: INT, j: INT, arrange: STR, arrive: STR, depart: STR, lens: STR, ornaments: STRS, speed: NUM, camera: CAMERA_AI })),
      work: closed({ theme: STR, mood: STR, season: SEASON_AI,
        amounts: closed(Object.fromEntries(WORK_AMOUNTS.map((k) => [k, NUM]))), flash: en(['keep', 'on', 'off']),
        palette: LH.PALETTE_SCHEMA }),
    });
  }

  function deepFreeze(v) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const k of Object.keys(v)) deepFreeze(v[k]);
    }
    return v;
  }

  function buildSchema(allowMaterials, media) {
    const props = { answers: arr(answerSchema(media)) };
    if (allowMaterials) props.materials = arr(media ? RECIPE.AI_MATERIAL_MEDIA : RECIPE.AI_MATERIAL);
    return deepFreeze(closed(props));
  }

  // Built once (the schemas are FROZEN data): 'all' × allowMaterials × media, and the camera schema.
  const SCHEMAS = Object.freeze({
    all: buildSchema(false, false), allMat: buildSchema(true, false), allMedia: buildSchema(false, true),
    allMatMedia: buildSchema(true, true),
    camera: deepFreeze(closed({ answers: arr(closed({ s: INT, understood: BOOL, summary: STR, question: STR,
      all: closed({ rig: STR, rigCurve: CURVE_AI, camera: CAMERA_AI }),
      lines: arr(closed({ i: INT, camera: CAMERA_AI })),
      cuts: arr(closed({ i: INT, j: INT, camera: CAMERA_AI })) })) })),
  });

  // directSchema({ mode, allowMaterials, media }) → the frozen answer schema of a request.
  function directSchema(opts) {
    const o = opts || {};
    if (o.mode === 'camera') return SCHEMAS.camera;
    return SCHEMAS['all' + (o.allowMaterials ? 'Mat' : '') + (o.media ? 'Media' : '')];
  }

  // ---- small helpers -----------------------------------------------------------------------------------------------

  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function str(v) { return typeof v === 'string' ? v.trim() : ''; }
  function round2(x) { return Math.round(x * 100) / 100; }
  function textsOf(lang) { return I18N.createT(lang === 'en' ? 'en' : 'ja', STRINGS, null, { strict: false }); }

  // curveFromAi(x) → Curve | undefined (keep) | null (unreadable) (§5.4; ai/recipe).
  const curveFromAi = RECIPE.curveFromAi;

  // cameraFromAi(CAMERA_AI value) → { shot?, zoom?, follow?, curve?, badShot, badCurve }: the cut slots cam.shot (a
  // preset, 'none', or a custom shot from the move words through core/shot.fromMove), cam.zoom (closer, 0.5–2),
  // cam.follow (0–1) and cam.curve. Absent fields keep; −1 keeps a number.
  function cameraFromAi(x) {
    const c = isObject(x) ? x : {};
    const out = { badShot: false, badCurve: false };
    const shot = str(c.shot);
    if (shot === 'none' || SHOT.SHOT_KEYS.includes(shot)) out.shot = shot;
    else if (shot === 'custom' || SHOT.MOVES.includes(shot)) {
      const ref = SHOT.fromMove({ move: shot === 'custom' ? c.move : shot, focus: c.focus, timing: c.timing, fill: c.fill });
      if (ref === undefined) out.badShot = true;
      else out.shot = ref;
    } else if (shot !== '') out.badShot = true;
    if (isNumber(c.closer) && c.closer >= 0) out.zoom = S.coerce(SPECS['cam.zoom'], c.closer);
    if (isNumber(c.follow) && c.follow >= 0) out.follow = S.coerce(SPECS['cam.follow'], c.follow);
    const curve = curveFromAi(c.curve);
    if (curve === null) out.badCurve = true;
    else if (curve !== undefined) out.curve = curve;
    return out;
  }

  // ---- requests (§5.2, §5.3) ---------------------------------------------------------------------------------------

  const SYSTEM = [
    'You direct parts ("areas") of a lyric-motion video (文字PV). Each brief is one area (its lines) plus the user\'s '
      + 'instruction for that area only. For each brief s, return the smallest set of settings that does what it asks; '
      + 'leave everything else.',
    'Numbering: in brief s, area lines are i = 0..n-1 and cuts of a line are j = 0..m-1. Lines marked (context) are outside '
      + 'the area: never change them. "" / [] / -1 mean keep.',
    'all = settings for every line of the area; lines[] = per-line exceptions (they win over all); cuts[] = one cut.',
    'Use only keys from the lists, or "mat:<name>" for a material you create in materials[].',
    'speed: speed of the words\' motion. 1 = as now, 0.5 = half speed (slow motion), 2 = twice as fast.',
  ];
  const SYSTEM_CURVES = 'Speed curves (arriveCurve, departCurve, flow, lensCurve, camera.curve, rigCurve): name = a curve '
    + 'preset or ease from the list, or "ramp" with ends (both|start|end), edge (0-0.4: how long the slow part lasts, share of '
    + 'the move) and peak (how many times faster the fast part is, 0.125-8). "最初と最後は一瞬遅く、途中はすごく速い" = '
    + '{name:"ramp", ends:"both", edge:0.1, peak:6}; "最初だけためて一気に" = ramp start. Prefer a preset when one fits.';
  const SYSTEM_CAMERA = 'camera: shot = a shot preset, "none" (no camerawork) or "custom" (then move, focus, timing and fill '
    + 'describe it; moving while the words animate = timing "arrive"; fill = how much of the frame the focus fills, 0.3 wide '
    + '... 1.1 very close). closer multiplies how close every shot is (0.5-2). follow = how much the camera leans toward moving '
    + 'letters (0-1). rig (in all only) = a slow camera move over the whole area.';
  const SYSTEM_REST = [
    'Season feel: set season for the area and use parts marked {season} of that season (atmos = particles over the background, '
      + 'ornaments = marks near the words, ground = background), or make a material. work.season changes the whole video: set '
      + 'it only when the brief is the whole video.',
    '"ゆっくり / slow here": speed < 1, calm curves (softEnds, fadeBrake, or ramp with a low peak), a calm shot (settle, '
      + 'wideHold, driftOff) and calm holds.',
    'Materials: only when no listed part fits. They are data built from the primitives below, never code. Prefer a variant '
      + '(base = an existing part of the same kind with other values). A material is used only where "use" or "mat:<name>" '
      + 'puts it.',
    'Never change the words of the lyrics. Locked lines keep their look.',
  ];
  const SYSTEM_MEDIA = 'Media: the user\'s photos and videos are listed as asset:<n>. Use one only when the instruction asks '
    + 'for a photo or video, or when it clearly fits the area. as = ground (background of the area), frame (a framed photo '
    + 'near the words), fill (inside the letters), overlay (footage over the scene). Prefer ground for wide scenic pictures, '
    + 'frame for people and objects, fill for textures. Never invent assets. depth = how that photo or video takes part in '
    + 'the animation: anim (moves with the camera and the words), front (in front of the words), back (pushed back, calmer), '
    + 'still (does not move); "keep" leaves it. With use "" it changes the one the area already shows as `as` '
    + '("背景を後ろに下げて" = as ground, depth back; "写真を前に出して" = as frame, depth front; "背景は動かさないで" = still; '
    + '"背景も一緒に動かして" = anim).';
  const SYSTEM_CAMERA_MODE = 'Choose camerawork that serves the lyrics: push to emphasized words, read along long lines, snap '
    + 'on impact lines (!), calm shots in quiet parts, and use the song\'s highlights if given.';

  function outLang(lang) { return lang === 'en' ? 'English' : 'Japanese'; }

  function systemText(mode, lang, media) {
    const understood = 'If a brief is unclear or impossible, set understood=false for it and ask in "question".';
    const write = 'Write "summary" (one sentence) and "question" in ' + outLang(lang) + '.';
    if (mode === 'camera') {
      return SYSTEM.slice(0, 3).concat([SYSTEM_CURVES, SYSTEM_CAMERA, 'Locked lines keep their look.', SYSTEM_CAMERA_MODE,
        understood, write]).join('\n');
    }
    return SYSTEM.concat([SYSTEM_CURVES, SYSTEM_CAMERA], SYSTEM_REST, media ? [SYSTEM_MEDIA] : [], [understood, write]).join('\n');
  }

  // The briefs that can be sent: at most 8, instructions flattened and cut to 300 characters, areas that still
  // resolve; mode 'all' needs an instruction, mode 'camera' may go without one.
  function cleanBriefs(doc, plan, briefs, mode) {
    const out = [];
    for (const b of list(briefs).slice(0, MAX_BRIEFS)) {
      if (!isObject(b)) continue;
      const instruction = Array.from(String(b.instruction || '').replace(/[\r\n]+/g, ' ').trim()).slice(0, MAX_INSTRUCTION).join('');
      if (!instruction && mode !== 'camera') continue;
      const area = AREAS.resolve(doc, plan, b.ref);
      if (area) out.push({ ref: b.ref, area, instruction });
    }
    return out;
  }

  // The lines a brief sends: an area's lines in time order; a cut area sends its one cut (as line 0, cut 0).
  function briefLines(plan, area, cutByKey, lineById) {
    if (area.kind === 'cut') {
      const cut = cutByKey.get(area.cutKeys[0]);
      const line = cut && cut.line ? lineById.get(cut.line) : null;
      return [{ line, cut, only: cut }];
    }
    return area.lineIds.map((id) => ({ line: lineById.get(id), cut: null, only: null })).filter((x) => x.line);
  }

  // Consecutive windows of whole areas, each ≤ MAX_LINES lines; one area larger than that is split into line ranges.
  function windowsOf(items) {
    const out = [];
    let cur = [], size = 0;
    const close = () => { if (cur.length) out.push(cur); cur = []; size = 0; };
    for (const it of items) {
      const n = it.rows.length;
      if (n > MAX_LINES) {
        close();
        for (let at = 0; at < n; at += MAX_LINES) {
          out.push([Object.assign({}, it, { rows: it.rows.slice(at, at + MAX_LINES), chunk: [at, Math.min(n, at + MAX_LINES), n] })]);
        }
        continue;
      }
      if (size + n > MAX_LINES) close();
      cur.push(Object.assign({}, it, { chunk: null }));
      size += n;
    }
    close();
    return out;
  }

  function curveShort(c) {
    const v = CV.coerce(c);
    if (v === undefined) return '-';
    if (typeof v === 'string') return v;
    if (v.ramp) return 'ramp(' + v.ramp.ends + ',' + v.ramp.edge + ',' + v.ramp.peak + ')';
    return 'custom';
  }

  function shortValue(v) {
    if (v === undefined || v === null || v === '') return '-';
    return typeof v === 'object' ? 'custom' : String(v);
  }

  function decision(cut, slot) {
    const d = cut && cut.slots ? cut.slots[slot] : null;
    return d || null;
  }

  // What a line shows now (its first cut): the state line of §5.3.
  function lineState(ctx, item) {
    const { plan, ix, media } = ctx;
    const line = item.line;
    const cut = item.cut || (line ? ctx.cutByKey.get(line.cuts[0]) : null);
    const v = (slot) => { const d = decision(cut, slot); return d ? d.v : undefined; };
    const arrive = decision(cut, 'arrive');
    const arriveText = arrive ? arrive.v + '(' + (arrive.p && isNumber(arrive.p.dur) ? String(round2(arrive.p.dur)).replace(/^0\./, '.') + 's, ' : '')
      + 'curve=' + curveShort(arrive.p && arrive.p.ease) + ')' : '-';
    const shot = decision(cut, 'cam.shot');
    const shotText = shot ? (typeof shot.v === 'string' ? shot.v : 'custom') + (shot.from === 'auto' ? '(auto)' : '') : '-';
    const orn = [0, 1, 2].map((i) => v('ornament#' + i)).filter((x) => x !== undefined && x !== 'none');
    const g = cut && plan.grounds && Number.isInteger(cut.ground) ? plan.grounds[cut.ground] : null;
    let ground = g && g.ground ? shortValue(g.ground.v) : '-';
    const image = g && g.ground && g.ground.p ? g.ground.p.image : '';
    if (image) {
      const hit = media.find((m) => m.id === image);
      ground += '(' + (hit ? 'asset:' + hit.n : 'photo') + ')';
    }
    const rig = cut && Array.isArray(plan.rigs) && Number.isInteger(cut.rig) && plan.rigs[cut.rig] ? plan.rigs[cut.rig].rig : null;
    const season = line ? PINS.lookup(ix, { cutKey: null, pinCutKey: null, lineId: line.id }, 'season') : null;
    const speed = v('motion.speed');
    return 'arrange=' + shortValue(v('arrange')) + ' arrive=' + arriveText + ' dwell=' + shortValue(v('dwell'))
      + ' depart=' + shortValue(v('depart')) + ' · lens=' + shortValue(v('lens')) + ' shot=' + shotText + ' camCurve='
      + curveShort(v('cam.curve')) + ' speed=' + (isNumber(speed) ? speed : 1) + ' · orn=' + (orn.length ? orn.join(',') : '-')
      + ' · atmos=' + (g && g.atmos ? shortValue(g.atmos.v) : '-') + ' ground=' + ground + ' · season='
      + (season && season.from === 'pin:line' ? season.v : '-') + ' rig=' + (rig ? shortValue(rig.v) : '-') + ' · locked:'
      + (line && line.locked ? 'yes' : 'no');
  }

  const AREA_WORDS = Object.freeze({ head: 'lyric heading', para: 'block of lines', lines: 'selected lines', cut: 'one cut' });

  function areaLabelText(t, area) {
    const [key, params] = area.label;
    const p = Object.assign({}, params);
    if (typeof p.kind === 'string' && t.has('songSec.' + p.kind)) p.kind = t('songSec.' + p.kind);
    return t(key, p);
  }

  function briefHeader(t, s, area, instruction, chunk, mode) {
    const what = instruction ? '「' + instruction + '」'
      : mode === 'camera' ? '(none: choose camerawork that suits the lyrics)' : '(none)';
    if (area.kind === 'work') {
      return 'Brief ' + s + ' — area: whole video' + (chunk ? ' (lines ' + (chunk[0] + 1) + '–' + chunk[1] + ' of ' + chunk[2]
        + '; whole-video settings belong to the first part)' : '') + ' — instruction: ' + what;
    }
    const kind = area.kind === 'song' ? area.songKind : area.kind === 'songKind' ? 'every ' + area.songKind : AREA_WORDS[area.kind];
    const n = chunk ? 'lines ' + (chunk[0] + 1) + '–' + chunk[1] + ' of ' + chunk[2] : area.n + (area.n === 1 ? ' line' : ' lines');
    return 'Brief ' + s + ' — area: ' + areaLabelText(t, area) + ' (' + kind + ', ' + area.t0.toFixed(1) + '–' + area.t1.toFixed(1)
      + ' s, ' + n + ') — instruction: ' + what;
  }

  // The brief's lines as sent (numbered i) plus one context line before and after (no number).
  function briefText(ctx, rows, t, s, it) {
    const out = [briefHeader(t, s, it.area, it.instruction, it.chunk, ctx.mode)];
    const sent = [];
    const first = rows[0] && rows[0].line ? rows[0].line.index : -1;
    const last = rows.length && rows[rows.length - 1].line ? rows[rows.length - 1].line.index : -1;
    const before = first > 0 ? ctx.plan.lines[first - 1] : null;
    const after = last >= 0 && last + 1 < ctx.plan.lines.length ? ctx.plan.lines[last + 1] : null;
    if (before && it.area.kind !== 'work') out.push('(context — do not change) ' + before.text);
    rows.forEach((row, i) => {
      const line = row.line;
      const keys = row.only ? [row.only.key] : line ? line.cuts : [];
      const cuts = keys.map((key, j) => {
        const cut = ctx.cutByKey.get(key);
        return { j, key, text: cut ? cut.text : '' };
      });
      const text = line ? line.text : row.cut ? row.cut.text : '';
      out.push(i + ': ' + text + ' · ' + lineState(ctx, row));
      out.push('  cuts: ' + cuts.map((c) => c.j + ' ' + c.text).join(' / '));
      sent.push({ i, lineId: line ? line.id : null, n: line ? line.index + 1 : 0, text, locked: !!(line && line.locked), cuts });
    });
    if (after && it.area.kind !== 'work') out.push('(context — do not change) ' + after.text);
    return { text: out.join('\n'), lines: sent };
  }

  function listsText(ctx, anyWork) {
    const { doc, registry, lang } = ctx;
    if (ctx.mode === 'camera') return 'Camera:\n' + CAT.cameraText(lang);
    const parts = CAT.catalog(registry, doc, ['arrange', 'arrive', 'dwell', 'depart', 'ornament', 'ground', 'lens', 'filter', 'atmos'],
      lang, { mine: false, cutOrnaments: true });
    const out = ['Parts (key=name{season}(mood tags)):', CAT.catalogText(parts)];
    const mine = CAT.materialsText(registry, lang);
    if (mine) out.push('', 'Materials of this project:', mine);
    out.push('', 'Camera:', CAT.cameraText(lang));
    if (anyWork) out.push('', 'Themes:', CAT.themesText(registry, lang, doc), '', 'Moods: ' + CAT.moodsText(registry, lang));
    if (ctx.media.length) out.push('', RECIPE.mediaText(ctx.media));
    if (ctx.allowMaterials) out.push('', CAT.recipeText({ media: ctx.media.length > 0 }));
    return out.join('\n');
  }

  // directRequests(doc, plan, registry, { briefs: [{ ref, instruction }], uiLang, mode: 'all' | 'camera', allowMaterials,
  // media }) → [{ system, prompt, schema, effort, sent }], one per window of ≤ 200 area lines (§5.2). media: true offers
  // the whole library, a list of asset ids only those (the ones whose bytes are on this device); false or absent
  // offers none. Only lyric text, the instructions, setting values and the assets' numbers, sizes and vision text are
  // sent (never a file name, §11.6.4).
  function directRequests(doc, plan, registry, opts) {
    const o = opts || {};
    const mode = o.mode === 'camera' ? 'camera' : 'all';
    const lang = o.uiLang === 'en' ? 'en' : 'ja';
    const allowMaterials = mode === 'all' && !!o.allowMaterials;
    const media = mode === 'all' && o.media ? RECIPE.mediaSent(doc, { only: Array.isArray(o.media) ? o.media : null, lang }) : [];
    const cutByKey = new Map((plan.cuts || []).map((c) => [c.key, c]));
    const lineById = new Map((plan.lines || []).map((l) => [l.id, l]));
    const items = cleanBriefs(doc, plan, o.briefs, mode).map((b) => Object.assign(b, { rows: briefLines(plan, b.area, cutByKey, lineById) }));
    const ctx = { doc, plan, registry, lang, mode, allowMaterials, media, cutByKey, ix: PINS.index(doc.pins) };
    const t = textsOf(lang);
    const windows = windowsOf(items);
    return windows.map((win, k) => {
      const briefs = [];
      const texts = win.map((it, s) => {
        const b = briefText(ctx, it.rows, t, s, it);
        briefs.push({ s, ref: it.ref, key: it.area.key, instruction: it.instruction, chunk: it.chunk, lines: b.lines });
        return b.text;
      });
      const anyWork = win.some((it) => it.area.kind === 'work');
      const prompt = [LH.lookContext(doc, plan), '', texts.join('\n\n'), '', listsText(ctx, anyWork)].join('\n');
      const schema = directSchema({ mode, allowMaterials, media: media.length > 0 });
      return {
        system: systemText(mode, lang, media.length > 0), prompt, schema, effort: mode === 'camera' ? 'low' : 'medium',
        sent: { window: k, windows: windows.length, mode, allowMaterials, uiLang: lang, media, briefs },
      };
    });
  }

  // ---- answers → changes (§5.5) ------------------------------------------------------------------------------------

  function linePin(ix, lineId, slot) {
    const hit = PINS.lookup(ix, { cutKey: null, pinCutKey: null, lineId }, slot);
    return hit && hit.from === 'pin:line' ? hit : null;
  }

  function cutAt(cut) { return { cutKey: cut.key, pinCutKey: cut.pinKey || cut.key, lineId: cut.line }; }

  // The plan cuts of a line (made once per line and answer set).
  function cutsOf(run, line) {
    let cuts = run.cutsOfLine.get(line.id);
    if (!cuts) {
      cuts = (line.cuts || []).map((k) => run.cutByKey.get(k)).filter(Boolean);
      run.cutsOfLine.set(line.id, cuts);
    }
    return cuts;
  }

  // The plan's decision for a slot of a cut: cut slots, ground and atmos (the cut's ground segment), rig and rig.curve
  // (its rig run, after package D), and params of a part slot ('arrive.ease', 'ground@photoPan.image').
  function decisionOf(run, cut, slot) {
    if (!cut) return null;
    const slots = cut.slots || {};
    if (slots[slot]) return slots[slot];
    const g = Array.isArray(run.plan.grounds) && Number.isInteger(cut.ground) ? run.plan.grounds[cut.ground] : null;
    if (slot === 'ground' || slot === 'atmos') return g && g[slot] ? g[slot] : null;
    if (slot === 'rig' || slot === 'rig.curve') {
      const r = Array.isArray(run.plan.rigs) && Number.isInteger(cut.rig) ? run.plan.rigs[cut.rig] : null;
      return r ? (slot === 'rig' ? r.rig : r.curve) || null : null;
    }
    const m = /^([a-z]+(?:#[0-9])?)(?:@([A-Za-z0-9]+))?\.([A-Za-z0-9]+)$/.exec(slot);
    if (!m) return null;
    const d = decisionOf(run, cut, m[1]);
    if (!d || !d.p || (m[2] && d.v !== m[2]) || !Object.prototype.hasOwnProperty.call(d.p, m[3])) return null;
    return { v: d.p[m[3]], from: d.pfrom && d.pfrom[m[3]] ? d.pfrom[m[3]] : d.from };
  }

  // What a target holds for a slot now: { v, source, own } (own = the target's own pin, if any).
  function current(run, T, slot) {
    const ix = run.ix;
    if (T.scope === 'work') {
      const hit = PINS.lookup(ix, EMPTY_AT, slot);
      return hit ? { v: hit.v, source: hit.from, own: hit } : { v: null, source: 'auto', own: null };
    }
    if (T.scope === 'line') {
      const own = linePin(ix, T.line.id, slot);
      if (own) return { v: own.v, source: own.from, own };
      const cut = cutsOf(run, T.line).find((c) => {
        const hit = PINS.lookup(ix, cutAt(c), slot);
        return !hit || hit.from !== 'pin:cut';
      });
      const d = decisionOf(run, cut, slot);
      return d ? { v: d.v, source: d.from, own: null } : { v: null, source: 'auto', own: null };
    }
    const hit = PINS.lookup(ix, cutAt(T.cut), slot);
    if (hit && hit.from === 'pin:cut') return { v: hit.v, source: hit.from, own: hit };
    const d = decisionOf(run, T.cut, slot);
    return d ? { v: d.v, source: d.from, own: null } : { v: null, source: 'auto', own: null };
  }

  // Whether every cut of a line that is not pinned by cut shows `to` for a slot now.
  function lineShows(run, line, slot, to) {
    const cuts = cutsOf(run, line).filter((c) => { const hit = PINS.lookup(run.ix, cutAt(c), slot); return !hit || hit.from !== 'pin:cut'; });
    return cuts.length > 0 && cuts.every((c) => { const d = decisionOf(run, c, slot); return !!d && CH.sameJSON(d.v, to); });
  }

  function fieldOf(slot) {
    if (FIELDS[slot]) return FIELDS[slot];
    const m = /@[A-Za-z0-9]+\.([A-Za-z0-9]+)$/.exec(slot);
    if (m && MEDIA_FIELDS[m[1]]) return MEDIA_FIELDS[m[1]];
    const kind = slot.replace(/#[0-9]$/, '');
    return 'kind.' + kind;
  }

  // Adds one change for a target and slot (first one wins per path), unless nothing would change: a part the target's
  // own pin already holds, a value the target already shows, or a line slot every cut of the line pins by hand.
  // x = { kind: 'part' | 'value', partKind?, fromAll, aggSlot?, requires?, matName?, matLabel?, toName? }
  function slotChange(run, b, T, slot, to, x) {
    const path = T.key + ':' + slot;
    if (run.byPath.has(path)) return run.byPath.get(path);
    if (T.scope === 'line') {
      const cuts = cutsOf(run, T.line);
      const byCut = cuts.map((c) => {
        const hit = PINS.lookup(run.ix, cutAt(c), slot);
        return hit && hit.from === 'pin:cut' ? hit : null;
      });
      if (cuts.length && byCut.every(Boolean)) {
        const field = fieldOf(slot);
        run.warn(byCut.every((h) => h.by === 'lock') ? ['ai.warn.locked', { n: T.n }]
          : ['ai.warn.pinned', Object.assign({ n: T.n }, Array.isArray(field) || !field.startsWith('kind.')
            ? { field: Array.isArray(field) ? field[0] : field } : { kind: x.partKind || slot })]);
        return null;
      }
    }
    const cur = current(run, T, slot);
    const placeholder = typeof to === 'string' && to.startsWith(MAT_PREFIX);
    // a value equal to the current one changes nothing; a line without its own pin has one only when all its cuts
    // (but those pinned by cut) show the same (§5.5)
    const same = x.kind === 'part' ? cur.own && CH.sameJSON(cur.own.v, to)
      : T.scope === 'line' && !cur.own ? lineShows(run, T.line, slot, to) : CH.sameJSON(cur.v, to);
    if (!placeholder && same) return null;
    const field = fieldOf(slot);
    const key = Array.isArray(field) ? field[0] : field;
    const fields = {
      id: b.prefix + path, kind: x.kind, scope: T.scope, path, slot, from: cur.v, fromSource: cur.source, to,
      group: T.scope === 'cut' ? 'cuts' : 'area', areaKey: b.key, field: key,
      label: ['ai.ch.value', { where: T.where, field: key, from: cur.v, to }],
    };
    if (Array.isArray(field)) fields.fieldKind = field[1];
    if (x.kind === 'part') fields.partKind = x.partKind;
    if (T.line) Object.assign(fields, { lineId: T.line.id, rowId: T.line.row, n: T.n });
    if (T.cut) Object.assign(fields, { cutKey: T.cut.key, cutSig: PL.pinSig(run.plan, T.cut.key) });
    if (x.fromAll && T.scope === 'line') fields.agg = b.key + '|' + (x.aggSlot || slot);
    if (x.requires) fields.requires = x.requires.slice();
    if (x.matName) fields.matName = x.matName;
    if (x.matLabel) fields.matLabel = x.matLabel;
    if (x.toName) fields.toName = x.toName;
    const c = CH.make(run.doc, fields, run.make);
    run.byPath.set(path, c);
    run.changes.push(c);
    return c;
  }

  // A cleared pin (use 'none' of media): a value change to null at the pin's own path.
  function clearChange(run, b, path) {
    if (run.byPath.has(path)) return;
    const parsed = P.parse(path);
    const pin = run.doc.pins[path];
    const scope = parsed.scope.kind;
    const line = parsed.scope.lineId ? run.lineById.get(parsed.scope.lineId) : null;
    const cut = scope === 'cut' ? run.cutByPinKey.get(parsed.scope.id) || null : null;
    const field = fieldOf(parsed.slot);
    const fields = {
      id: b.prefix + path, kind: 'value', scope, path, slot: parsed.slot, from: pin.v, fromSource: 'pin:' + scope, to: null,
      group: scope === 'cut' ? 'cuts' : 'area', areaKey: b.key, field: Array.isArray(field) ? field[0] : field,
      label: ['ai.ch.value', { where: whereOf(run, scope, line, cut), field: Array.isArray(field) ? field[0] : field, from: pin.v, to: null }],
    };
    if (Array.isArray(field)) fields.fieldKind = field[1];
    if (line) Object.assign(fields, { lineId: line.id, rowId: line.row, n: line.index + 1 });
    if (cut) Object.assign(fields, { cutKey: cut.key, cutSig: PL.pinSig(run.plan, cut.key) });
    const c = CH.make(run.doc, fields, run.make);
    run.byPath.set(path, c);
    run.changes.push(c);
  }

  // [stringKey, params] naming where a change lands: the whole video, a line, a cut of a line, or a special cut
  // (title, intro, outro, an interlude after line n), as planner/areas labels them.
  function whereOf(run, scope, line, cut) {
    if (scope === 'work') return ['area.work', {}];
    const n = line ? line.index + 1 : 0;
    if (scope === 'line') return ['area.linesOne', { a: n }];
    if (line) return ['area.cut', { n, k: line.cuts.indexOf(cut ? cut.key : '') + 1 }];
    const key = cut ? cut.key : '';
    if (key.startsWith('gap/')) {
      const before = run.lineById.get(key.slice(4));
      return ['crumb.gap', { n: before ? before.index + 1 : 0 }];
    }
    return ['crumb.' + key, {}];
  }

  // ---- targets -----------------------------------------------------------------------------------------------------

  function workTarget(run) { return { scope: 'work', key: 'work', line: null, cut: null, n: 0, where: ['area.work', {}] }; }

  function lineTarget(run, line) {
    return { scope: 'line', key: 'line/' + line.id, line, cut: null, n: line.index + 1, where: ['area.linesOne', { a: line.index + 1 }] };
  }

  // A cut's pins are written where they live (the plan cut's pinKey, as the inspector does).
  function cutTarget(run, cut) {
    const line = cut.line ? run.lineById.get(cut.line) || null : null;
    return { scope: 'cut', key: 'cut/' + (cut.pinKey || cut.key), line, cut, n: line ? line.index + 1 : 0,
      where: whereOf(run, 'cut', line, cut) };
  }

  // The plan line of a sent line i, or a warning: outside the brief → notInArea; gone, other words since or no longer
  // in the area → changedSince / notInArea.
  function sentLine(run, b, i) {
    const s = Number.isInteger(i) && i >= 0 ? b.brief.lines[i] : null;
    if (!s) return { warn: ['ai.warn.notInArea', { n: (Number.isInteger(i) ? i : -1) + 1 }] };
    const line = s.lineId ? run.lineById.get(s.lineId) : null;
    if (!s.lineId) return { sent: s, line: null };
    if (!line || line.text !== s.text) return { warn: ['ai.warn.changedSince', { n: s.n || i + 1 }] };
    if (!b.area.lineIds.includes(line.id)) return { warn: ['ai.warn.notInArea', { n: line.index + 1 }] };
    return { sent: s, line };
  }

  // ---- one edit on one target ----------------------------------------------------------------------------------------

  function isOff(doc, kind, key) {
    const f = doc.filters[kind];
    return !!f && ((Array.isArray(f.deny) && f.deny.includes(key)) || (Array.isArray(f.only) && !f.only.includes(key)));
  }

  // The season a target's seasonal picks must match (§5.5 season gate): the answer's season for it, else the line's
  // own season pin, else the season of the whole video after the answer.
  function seasonOf(run, T, answered) {
    if (answered) return answered;
    if (T.line) {
      const own = linePin(run.ix, T.line.id, 'season');
      if (own && typeof own.v === 'string') return own.v;
    }
    return run.workSeason;
  }

  function warnKind(T, kind, key) {
    return T.scope === 'work' ? ['ai.warn.unknown', { kind, key }] : ['ai.warn.lineUnknown', { n: T.n, kind, key }];
  }

  function seasonWarn(T, kind, key) {
    return T.scope === 'work' ? ['ai.warn.offSeason', { kind, key }] : ['ai.warn.lineOffSeason', { n: T.n, kind, key }];
  }

  function offWarn(T, kind, key) {
    return T.scope === 'work' ? ['ai.warn.turnedOff', { kind, key }] : ['ai.warn.filtered', { n: T.n, kind, key }];
  }

  // A part pick on a target: a registry key (valid for the slot, in season, not turned off) or 'mat:<name>'.
  function partTo(run, b, T, slot, key, src) {
    const regKind = slot === 'atmos' ? 'ornament' : slot.replace(/#[0-9]$/, '');
    if (key.startsWith(MAT_PREFIX)) return materialRef(run, b, T, slot, key.slice(MAT_PREFIX.length), src);
    const def = run.registry.get(regKind, key);
    const ok = slot === 'atmos' ? key === 'none' || (!!def && def.scope === 'run')
      : !!def && CAT.servesLyrics(run.registry, regKind, key) && !(regKind === 'ornament' && def.scope === 'run');
    if (!ok) { run.warn(warnKind(T, slot === 'atmos' ? 'atmos' : regKind, key)); return null; }
    if (def && !CAT.inSeason(def, src.season)) { run.warn(seasonWarn(T, regKind, key)); return null; }
    if (def && isOff(run.doc, regKind, key) && !run.allowed.has(regKind + '.' + key)) {
      run.warn(offWarn(T, regKind, key));
      return null;
    }
    return slotChange(run, b, T, slot, key, { kind: 'part', partKind: regKind, fromAll: src.fromAll });
  }

  // The first free index of ornament#i / filter#i on a target (§5.5): not pinned by the user or a lock on the target,
  // on its line (for a cut) or on its cuts (for a line). Each index is handed out once per answer set.
  function allocate(run, T, kind) {
    const k = T.key + '|' + kind;
    if (!run.alloc.has(k)) {
      const taken = new Set();
      const busy = (path) => !!run.doc.pins[path] && run.doc.pins[path].by !== 'ai';
      for (let i = 0; i < 3; i++) {
        const slot = kind + '#' + i;
        const paths = [T.key + ':' + slot];
        if (T.scope === 'line') for (const c of cutsOf(run, T.line)) paths.push('cut/' + (c.pinKey || c.key) + ':' + slot);
        if (T.scope === 'cut' && T.line) paths.push('line/' + T.line.id + ':' + slot);
        if (paths.some(busy)) taken.add(i);
      }
      run.alloc.set(k, taken);
    }
    const taken = run.alloc.get(k);
    for (let i = 0; i < 3; i++) if (!taken.has(i)) { taken.add(i); return i; }
    return null;
  }

  // A key already on one of the target's list slots (its own pins or this answer's changes) is not added again.
  function placed(run, T, kind, key) {
    const k = T.key + '|' + kind + '|' + key;
    if (run.placed.has(k)) return true;
    for (let i = 0; i < 3; i++) {
      const pin = run.doc.pins[T.key + ':' + kind + '#' + i];
      if (pin && pin.v === key) return true;
    }
    run.placed.add(k);
    return false;
  }

  function listTo(run, b, T, kind, keys, src) {
    const items = keys.map(str).filter(Boolean);
    if (items.length === 1 && items[0] === 'none') {
      slotChange(run, b, T, kind + '.count', 0, { kind: 'value', fromAll: src.fromAll });
      return;
    }
    for (const key of items.slice(0, 3)) {
      if (key === 'none') continue;
      const mat = key.startsWith(MAT_PREFIX) ? run.mats.get(key.slice(MAT_PREFIX.length).trim()) : null;
      const def = mat ? null : run.registry.get(kind, key);
      // a run-scope ornament named among the ornaments is meant as the atmosphere
      if (kind === 'ornament' && ((def && def.scope === 'run') || (mat && mat.entry.recipe.scope === 'run'))) {
        partTo(run, b, T, 'atmos', key, src);
        continue;
      }
      if (!mat && !key.startsWith(MAT_PREFIX)) {
        if (!def) { run.warn(warnKind(T, kind, key)); continue; }
        if (!CAT.inSeason(def, src.season)) { run.warn(seasonWarn(T, kind, key)); continue; }
        if (isOff(run.doc, kind, key) && !run.allowed.has(kind + '.' + key)) { run.warn(offWarn(T, kind, key)); continue; }
        if (kind === 'filter' && !FR.filterAllowed(def, run.doc.look.backdrop)) { run.warn(['ai.warn.backdrop', { n: T.n }]); continue; }
      }
      if (placed(run, T, kind, key)) continue;
      const i = allocate(run, T, kind);
      if (i === null) { run.warn(['ai.warn.noSlot', { n: T.n }]); return; }
      if (key.startsWith(MAT_PREFIX)) materialRef(run, b, T, kind + '#' + i, key.slice(MAT_PREFIX.length), src);
      else slotChange(run, b, T, kind + '#' + i, key, { kind: 'part', partKind: kind, fromAll: src.fromAll, aggSlot: kind + ':' + key });
    }
  }

  // avoid (§5.5): the line's list grows by the valid refs; a whole-video brief turns the parts off instead (filters).
  function avoidTo(run, b, T, refs, src) {
    if (!refs.length || T.scope === 'cut') return;
    if (T.scope === 'work') {
      const out = [];
      LH.filterChanges(run.lctx(b), refs, [], out);
      for (const c of out) run.push(Object.assign(c, { group: 'area', areaKey: b.key }));
      return;
    }
    const valid = refs.map(str).filter((r) => {
      const m = /^([a-z]+)\.([A-Za-z0-9]+)$/.exec(r);
      return !!m && run.registry.has(m[1], m[2]);
    });
    if (!valid.length) return;
    const own = linePin(run.ix, T.line.id, 'avoid');
    const before = own && Array.isArray(own.v) ? own.v : [];
    const to = S.coerce({ type: 'partRefs' }, before.concat(valid));
    if (to === undefined || CH.sameJSON(to, before)) return;
    slotChange(run, b, T, 'avoid', to, { kind: 'value', fromAll: src.fromAll });
  }

  function valueTo(run, b, T, slot, to, src) {
    if (to === undefined) return null;
    return slotChange(run, b, T, slot, to, { kind: 'value', fromAll: src.fromAll });
  }

  function speedTo(run, b, T, v, src) {
    if (!isNumber(v) || v < 0) return;
    const to = S.coerce(SPECS['motion.speed'], v);
    const cur = current(run, T, 'motion.speed');
    const from = isNumber(cur.v) ? cur.v : 1;
    if (Math.abs(to - from) < SPEED_EPS) return;
    valueTo(run, b, T, 'motion.speed', to, src);
  }

  function curvesTo(run, b, T, e) {
    for (const field of Object.keys(CURVE_FIELDS)) {
      if (!(field in e)) continue;
      const c = curveFromAi(e[field].v);
      if (c === null) run.warn(['ai.warn.badCurve', {}]);
      else valueTo(run, b, T, CURVE_FIELDS[field], c, e[field]);
    }
  }

  function cameraTo(run, b, T, cam) {
    if (cam.badShot) run.warn(['ai.warn.badShot', {}]);
    if (cam.badCurve) run.warn(['ai.warn.badCurve', {}]);
    const slots = { shot: 'cam.shot', zoom: 'cam.zoom', follow: 'cam.follow', curve: 'cam.curve' };
    for (const k of Object.keys(slots)) if (cam[k] && cam[k].v !== undefined) valueTo(run, b, T, slots[k], cam[k].v, cam[k]);
  }

  function rigTo(run, b, T, e) {
    if (e.rig) {
      const rig = e.rig.v;
      if (rig === 'none' || SHOT.RIG_KEYS.includes(rig)) valueTo(run, b, T, 'rig', rig, e.rig);
      else run.warn(['ai.warn.badShot', {}]);
    }
    if (e.rigCurve) {
      const c = curveFromAi(e.rigCurve.v);
      if (c === null) run.warn(['ai.warn.badCurve', {}]);
      else valueTo(run, b, T, 'rig.curve', c, e.rigCurve);
    }
  }

  // ---- media (§11.6.1) ---------------------------------------------------------------------------------------------

  function docAsset(doc, id) {
    const all = doc.media && Array.isArray(doc.media.list) ? doc.media.list : [];
    return all.find((e) => e.id === id) || null;
  }

  function fitsAccept(accept, entry) {
    if (accept === 'image') return entry.kind === 'image';
    if (accept === 'video') return entry.kind === 'video' || entry.anim === true;
    return true;
  }

  // use 'none': the AI's pins in the target whose value is a media part or an asset are cleared.
  function clearMedia(run, b, T) {
    const scope = T.scope === 'cut' ? 'cut/' + T.cut.key : T.key;
    for (const path of Object.keys(run.doc.pins).sort()) {
      const pin = run.doc.pins[path];
      if (!pin || pin.by !== 'ai' || !(MEDIA_PARTS.includes(pin.v) || MEDIA.isId(pin.v))) continue;
      let under = false;
      try { under = P.isUnder(path, scope) || (T.scope === 'cut' && P.isUnder(path, T.key)); } catch (e) { under = false; }
      if (under) clearChange(run, b, path);
    }
  }

  // depth (§11.9.4) of a media part on a target: a pin of its `depth` param, when the part has one.
  function depthTo(run, b, T, slot, kind, key, depth, src, aggBase) {
    const def = run.registry.get(kind, key);
    const spec = def && def.params ? def.params.depth : null;
    const v = spec ? S.coerce(spec, depth) : undefined;
    if (v === undefined) return;
    slotChange(run, b, T, slot + '@' + key + '.depth', v, { kind: 'value', fromAll: src.fromAll, aggSlot: aggBase + '.depth' });
  }

  // use '' with a depth: the media part the target shows now as `as` (the ground's photoPan or a pooled asset's ground,
  // the atmosphere's mediaLayer, every photoFrame of its ornaments; fill has no depth).
  function depthOfShown(run, b, T, m, src) {
    const as = MEDIA_USES[m.as] || MEDIA_USES.ground;
    if (m.as === 'fill') return;
    if (as.slot === 'ornament') {
      for (let i = 0; i < 3; i++) {
        if (current(run, T, 'ornament#' + i).v === as.key) depthTo(run, b, T, 'ornament#' + i, 'ornament', as.key, m.depth, src, 'ornament:' + as.key);
      }
      return;
    }
    const shown = current(run, T, as.slot).v;
    const ok = as.slot === 'ground' ? shown === as.key || DERIVED_MEDIA.test(String(shown)) : shown === as.key;
    if (ok) depthTo(run, b, T, as.slot, as.kind, shown, m.depth, src, as.slot);
  }

  function mediaTo(run, b, T, m, src) {
    const use = str(m.use);
    if (!use) {
      if (MEDIA.DEPTHS.includes(m.depth)) depthOfShown(run, b, T, m, src);
      return;
    }
    if (use === 'none') { clearMedia(run, b, T); return; }
    const asset = RECIPE.assetOf(run.sent.media, use);
    const entry = asset ? docAsset(run.doc, asset.id) : null;
    if (!entry) { run.warnOnce(['ai.warn.mediaUnknown', { name: use }]); return; }
    const as = MEDIA_USES[m.as] || MEDIA_USES.ground;
    const def = run.registry.get(as.kind, as.key);
    if (!def) { run.warnOnce(['ai.warn.unknown', { kind: as.kind, key: as.key }]); return; }
    const spec = def.params ? def.params[as.param] : null;
    const accept = spec && spec.type === 'media' ? spec.accept || 'any' : 'any';
    // the planner's own words for this (§11.2.6 media-kind): the string exists, the AI adds none
    if (!fitsAccept(accept, entry)) { run.warnOnce(['warn.media-kind', { detail: entry.name }]); return; }
    let slot = as.slot;
    if (slot === 'ornament') {
      if (placed(run, T, 'ornament', as.key + '|' + entry.id)) return;
      const i = allocate(run, T, 'ornament');
      if (i === null) { run.warn(['ai.warn.noSlot', { n: T.n }]); return; }
      slot = 'ornament#' + i;
    }
    const aggBase = as.slot === 'ornament' ? 'ornament:' + as.key : slot;
    slotChange(run, b, T, slot, as.key, { kind: 'part', partKind: as.kind, fromAll: src.fromAll, aggSlot: aggBase });
    const timed = entry.kind === 'video' || entry.anim === true;
    const params = [[as.param, entry.id]];
    if (MEDIA.FITS.includes(m.fit)) params.push(['fit', m.fit]);
    if (isNumber(m.blur) && m.blur >= 0) params.push(['blur', m.blur]);
    if (isNumber(m.veil) && m.veil >= 0) params.push(['veil', m.veil]);
    if (timed && isNumber(m.from) && m.from >= 0) params.push(['clipIn', isNumber(entry.dur) && m.from >= entry.dur ? 0 : m.from]);
    if (timed && isNumber(m.speed) && m.speed >= 0) params.push(['speed', m.speed]);
    for (const [name, v] of params) {
      const ps = def.params ? def.params[name] : null;
      if (!ps) continue;                                   // a param this part does not have (yet)
      const value = name === as.param ? entry.id : S.coerce(ps, v);
      if (value === undefined) continue;
      slotChange(run, b, T, slot + '@' + as.key + '.' + name, value, { kind: 'value', fromAll: src.fromAll,
        aggSlot: aggBase + '.' + name, toName: name === as.param ? entry.name : undefined });
    }
    if (MEDIA.DEPTHS.includes(m.depth)) depthTo(run, b, T, slot, as.kind, as.key, m.depth, src, aggBase);
  }

  // ---- materials (§5.10, §5.11) ------------------------------------------------------------------------------------

  // The answer's materials → material changes; each is known by its name for 'mat:<name>' and its `use`. Only as many
  // as doc.materials has room for (§5.8: 64 entries, 160 KB): each is put on a copy of the document that already holds
  // the ones before it (and `before`, the material changes of earlier windows); the first that does not fit and all
  // after it are left out (ai.warn.matFull), and their uses fall away as unknown materials.
  function materialsOf(run, materials, before) {
    let k = 0;
    let room = CH.apply(run.doc, run.plan, list(before));
    let left = 0;
    list(materials).forEach((m, idx) => {
      if (left) { left++; return; }
      const res = RECIPE.fromAi(m, run.registry, null, { media: run.sent.media && run.sent.media.length ? run.sent.media : null,
        lang: run.sent.uiLang });
      res.warnings.forEach(run.warn);
      if (!res.entry) return;
      const raw = str(isObject(m) ? m.name : '');
      const name = res.entry.name.ja;
      if (run.mats.has(raw || name) || run.mats.has(name)) return;
      const change = RECIPE.materialChange(run.doc, res.entry, { id: run.prefix + 'mat:' + idx, k, matName: name }, run.make);
      try { room = CH.apply(room, run.plan, [change]); } catch (e) { left = 1; return; }
      k++;
      const mat = { change, entry: res.entry, use: isObject(m) ? m.use : null, name };
      run.mats.set(name, mat);
      if (raw) run.mats.set(raw, mat);
      run.changes.push(change);
    });
    if (left) run.warn(['ai.warn.matFull', { n: left }]);
  }

  // A material placed on a target (a 'mat:<name>' field or its `use`): a part pin that requires the material, plus a
  // season change for the line when the material's season is not the one in effect there (§5.11).
  function materialRef(run, b, T, slot, name, src) {
    const mat = run.mats.get(String(name).trim());
    if (!mat) { run.warnOnce(['ai.warn.matUnknown', { name: String(name).trim() }]); return null; }
    const e = mat.entry;
    const want = RECIPE.slotFor(e);
    const base = slot.replace(/#[0-9]$/, '');
    if (want !== base) { run.warn(warnKind(T, base, name)); return null; }
    const c = slotChange(run, b, T, slot, MAT_PREFIX + mat.name, { kind: 'part', partKind: e.kind, fromAll: src.fromAll,
      requires: [mat.change.id], matName: mat.name, matLabel: e.name, aggSlot: base + ':' + MAT_PREFIX + mat.name });
    if (c && e.season && !src.seasonSet && b.area.kind !== 'cut') {
      const season = seasonOf(run, T, null);
      if (season !== e.season && season !== 'any') {
        if (T.scope === 'work') { if (!run.workSeasonSet) workSeasonFor(run, b, e.season, mat); }
        else if (T.line) {
          slotChange(run, b, lineTarget(run, T.line), 'season', e.season, { kind: 'value', fromAll: src.fromAll,
            requires: [mat.change.id] });
        }
      }
    }
    return c;
  }

  function workSeasonFor(run, b, season, mat) {
    const out = [];
    LH.seasonChanges(run.lctx(b, 'mat'), { season }, out);
    for (const c of out) run.push(Object.assign(c, { group: 'area', areaKey: b.key, requires: [mat.change.id] }));
  }

  // `use` of a material (§5.11): slot 'none' puts it nowhere; otherwise every area line (or use.lines / use.cuts) of
  // brief use.s (−1 = every brief) gets the pin its kind takes.
  function useChanges(run, mat) {
    const use = isObject(mat.use) ? mat.use : null;
    if (!use || !RECIPE.USE_SLOTS.includes(use.slot) || use.slot === 'none') return;
    const briefs = use.s === -1 ? [...run.briefCtx.values()] : run.briefCtx.has(use.s) ? [run.briefCtx.get(use.s)] : [];
    const want = RECIPE.slotFor(mat.entry);
    for (const b of briefs) {
      const src = { fromAll: true, season: null, seasonSet: false };
      const place = (T) => {
        if (T.line && T.line.locked) { run.warn(['ai.warn.locked', { n: T.n }]); return; }
        const s = Object.assign({}, src, { seasonSet: T.line ? run.seasonSet.has(T.line.id) : false });
        if (want === 'seam') {
          const first = T.scope === 'line' ? run.cutByKey.get(T.line.cuts[0]) : T.cut;
          const at = first ? cutTarget(run, first) : T;
          materialRef(run, b, at, 'seam', mat.name, s);
        } else if (want === 'ornament' || want === 'filter') {
          if (placed(run, T, want, MAT_PREFIX + mat.name)) return;
          const i = allocate(run, T, want);
          if (i === null) run.warn(['ai.warn.noSlot', { n: T.n }]);
          else materialRef(run, b, T, want + '#' + i, mat.name, s);
        } else materialRef(run, b, T, want, mat.name, s);
      };
      if (b.area.kind === 'work' && !list(use.cuts).length && !list(use.lines).length) { place(workTarget(run)); continue; }
      if (b.area.kind === 'cut') { const cut = run.cutByKey.get(b.area.cutKeys[0]); if (cut) place(cutTarget(run, cut)); continue; }
      if (list(use.cuts).length) {
        for (const x of list(use.cuts)) {
          const cut = sentCut(run, b, x && x.i, x && x.j);
          if (cut.cut) place(cutTarget(run, cut.cut));
          else if (cut.warn) run.warn(cut.warn);
        }
        continue;
      }
      const lines = list(use.lines).length ? list(use.lines).map((i) => sentLine(run, b, i)) : b.lineTargets.map((x) => ({ line: x.line }));
      for (const r of lines) {
        if (r.warn) run.warn(r.warn);
        else if (r.line) place(lineTarget(run, r.line));
      }
    }
  }

  function sentCut(run, b, i, j) {
    const r = sentLine(run, b, i);
    if (r.warn) return r;
    const c = Number.isInteger(j) && j >= 0 ? r.sent.cuts[j] : null;
    const cut = c ? run.cutByKey.get(c.key) : null;
    if (!cut || cut.text !== c.text) return { warn: ['ai.warn.changedSince', { n: r.sent.n || (Number.isInteger(i) ? i + 1 : 0) }] };
    return { cut };
  }

  // ---- merging edits -------------------------------------------------------------------------------------------------

  // The fields an edit sets, as { field: { v, fromAll } }: '' / [] / −1 are left out. `camera` becomes its four slots,
  // `media` stays whole (set when use is not '').
  function setFields(e, fromAll) {
    const out = {};
    if (!isObject(e)) return out;
    const put = (k, v) => { out[k] = { v, fromAll }; };
    for (const k of PART_FIELDS.concat(['ground', 'atmos', 'rig'])) if (str(e[k])) put(k, str(e[k]));
    for (const k of ['ornaments', 'filters', 'avoid', 'emphasis']) if (list(e[k]).some((x) => str(x))) put(k, list(e[k]).map(str).filter(Boolean));
    if (LINE_SEASONS.includes(e.season)) put('season', e.season);
    if (isNumber(e.speed) && e.speed >= 0) put('speed', e.speed);
    for (const k of Object.keys(CURVE_FIELDS).concat(['rigCurve'])) if (isObject(e[k]) && str(e[k].name)) put(k, e[k]);
    if (isObject(e.camera)) {
      const cam = cameraFromAi(e.camera);
      out.camera = { badShot: cam.badShot, badCurve: cam.badCurve };
      for (const k of ['shot', 'zoom', 'follow', 'curve']) if (cam[k] !== undefined) out.camera[k] = { v: cam[k], fromAll };
      // an unreadable shot or curve is still set: it overrides the area's (and gives no change)
      if (cam.badShot) out.camera.shot = { v: undefined, fromAll };
      if (cam.badCurve) out.camera.curve = { v: undefined, fromAll };
    }
    if (e.impact === 'on' || e.impact === 'off') put('impact', e.impact === 'on');
    if (isObject(e.media) && (str(e.media.use) || MEDIA.DEPTHS.includes(e.media.depth))) put('media', e.media);
    return out;
  }

  // lines[i] wins over all, field by field (camera slot by slot).
  function merged(allSet, lineSet) {
    const out = Object.assign({}, allSet, lineSet);
    if (allSet.camera || lineSet.camera) {
      out.camera = Object.assign({}, allSet.camera || {}, lineSet.camera || {});
      out.camera.badShot = !!((lineSet.camera && lineSet.camera.badShot) || (allSet.camera && allSet.camera.badShot && !lineSet.camera));
      out.camera.badCurve = !!((lineSet.camera && lineSet.camera.badCurve) || (allSet.camera && allSet.camera.badCurve && !lineSet.camera));
    }
    return out;
  }

  const LOOK_FIELDS = Object.freeze(PART_FIELDS.concat(['ground', 'atmos', 'rig', 'rigCurve', 'ornaments', 'filters', 'avoid',
    'season', 'speed', 'camera', 'media'], Object.keys(CURVE_FIELDS)));

  // Every set field of a merged edit on one target (§5.5 mapping table).
  function applyEdit(run, b, T, e) {
    const look = LOOK_FIELDS.filter((k) => k in e);
    if (T.line && T.line.locked && look.length) { run.warn(['ai.warn.locked', { n: T.n }]); return; }
    const seasonSet = 'season' in e && T.scope !== 'work';
    const season = seasonOf(run, T, seasonSet ? e.season.v : null);
    const src = (k) => ({ fromAll: e[k] ? e[k].fromAll : false, season, seasonSet });
    if (seasonSet && T.scope === 'line') valueTo(run, b, T, 'season', e.season.v, src('season'));
    for (const k of PART_FIELDS.concat(['ground', 'atmos'])) if (e[k]) partTo(run, b, T, k, e[k].v, src(k));
    if (e.ornaments) listTo(run, b, T, 'ornament', e.ornaments.v, src('ornaments'));
    if (e.filters) listTo(run, b, T, 'filter', e.filters.v, src('filters'));
    if (e.avoid) avoidTo(run, b, T, e.avoid.v, src('avoid'));
    if (e.speed) speedTo(run, b, T, e.speed.v, src('speed'));
    curvesTo(run, b, T, e);
    if (e.camera) cameraTo(run, b, T, e.camera);
    if (T.scope !== 'cut' || b.area.kind === 'cut') rigTo(run, b, T, e);
    if (e.media) mediaTo(run, b, T, e.media.v, src('media'));
  }

  // ---- the work part of an answer --------------------------------------------------------------------------------------

  function amountCamera(run, lctx, amounts, out) {
    const v = isObject(amounts) && isNumber(amounts.camera) ? amounts.camera : -1;
    if (!(v >= 0)) return;
    const to = Math.round(Math.min(1, v) * 100) / 100;
    const pinned = PINS.lookup(run.ix, EMPTY_AT, 'amount.camera');
    const from = pinned && isNumber(pinned.v) ? pinned.v : Number(run.plan.look.amounts.camera || 0);
    if (Math.abs(to - from) < AMOUNT_EPS) return;
    out.push(CH.make(run.doc, { id: 'amount:camera', kind: 'amount', key: 'camera', scope: 'work', path: 'work:amount.camera',
      from, fromSource: pinned ? 'pin:work' : 'auto', to, label: ['ai.ch.amount', { what: 'camera', from, to }] }, lctx.opts));
  }

  // work.* (and a whole-video brief's season and avoid): the existing work kinds. Checked in a whole-video brief;
  // otherwise they change more than the area, so they land unchecked in 'outside'.
  function workChanges(run, b, w, seasonAll) {
    const isWork = b.area.kind === 'work';
    const x = isObject(w) ? w : {};
    const season = isWork && seasonAll ? seasonAll : LINE_SEASONS.includes(x.season) ? x.season : '';
    const lctx = run.lctx(b, 'work');
    const out = [];
    const warn = run.warn;
    const eff = LH.seasonChanges(lctx, { season }, out);
    LH.namedChange(lctx, 'theme', str(x.theme), eff, warn, out);
    LH.namedChange(lctx, 'mood', str(x.mood), eff, warn, out);
    const moodKey = (out.find((c) => c.kind === 'mood') || {}).to || null;
    LH.amountChanges(lctx, x.amounts, moodKey, out);
    amountCamera(run, lctx, x.amounts, out);
    LH.flashChange(lctx, x.flash === 'on' || x.flash === 'off' ? x.flash : 'keep', moodKey, out);
    const themeKey = (out.find((c) => c.kind === 'theme') || {}).to || run.plan.look.theme.v;
    LH.paletteChange(lctx, x.palette, themeKey, out);
    for (const c of out) run.push(Object.assign(c, { group: isWork ? 'work' : 'outside', areaKey: b.key, checked: isWork }));
  }

  // The season of the whole video after the answers: a whole-video brief's season, else the plan's.
  function workSeasonAfter(run, answers) {
    let season = run.plan.look.season.v;
    for (const a of answers) {
      const brief = run.briefs[a.s];
      if (!brief || a.understood === false || !brief.ref || brief.ref.kind !== 'work') continue;
      const s = isObject(a.all) && LINE_SEASONS.includes(a.all.season) ? a.all.season
        : isObject(a.work) && LINE_SEASONS.includes(a.work.season) ? a.work.season : '';
      if (s) run.workSeasonSet = true;
      if (s && s !== 'any') season = s;
    }
    return season;
  }

  // ---- one answer ------------------------------------------------------------------------------------------------------

  function answerChanges(run, a) {
    const brief = run.briefs[a.s];
    const res = { s: a.s, areaKey: brief.key, understood: a.understood !== false,
      summary: String(a.summary || '').slice(0, MAX_INSTRUCTION), question: String(a.question || '').slice(0, MAX_INSTRUCTION) };
    const area = AREAS.resolve(run.doc, run.plan, brief.ref);
    if (!area) { run.warn(['ai.warn.areaGone', {}]); return res; }
    res.areaKey = area.key;
    run.areas.set(area.key, area);
    if (!res.understood) return res;
    const b = { s: a.s, brief, area, key: area.key, prefix: run.prefix + 's' + a.s + ':', lineTargets: [] };
    run.briefCtx.set(a.s, b);
    const allSet = setFields(a.all, true);
    const lineSets = new Map();
    for (const l of list(a.lines)) if (isObject(l) && !lineSets.has(l.i)) lineSets.set(l.i, l);
    if (area.kind === 'cut') {
      const cut = run.cutByKey.get(area.cutKeys[0]);
      const cutEdit = list(a.cuts).find((c) => isObject(c) && c.i === 0 && c.j === 0);
      const e = merged(merged(allSet, setFields(lineSets.get(0), false)), cutOnly(setFields(cutEdit, false)));
      if (cut) applyEdit(run, b, cutTarget(run, cut), e);
    } else {
      linesOfBrief(run, b, allSet, lineSets);
      if (area.kind === 'work' && !(brief.chunk && brief.chunk[0] > 0)) {
        const workSet = Object.assign({}, allSet);
        for (const k of ['season', 'impact', 'emphasis']) delete workSet[k];   // the season of the video is a work change
        applyEdit(run, b, workTarget(run), workSet);
      }
      const lyric = [];
      for (const { line, i } of b.lineTargets) {
        const own = setFields(lineSets.get(i), false);
        const e = area.kind === 'work' ? own : merged(allSet, own);
        applyEdit(run, b, lineTarget(run, line), e);
        const imp = own.impact || allSet.impact;
        if (imp) lyric.push({ i: line.index, line, kind: 'impact', to: imp.v });
        const emph = own.emphasis || allSet.emphasis;
        for (const w of emph ? emph.v.slice(0, 2) : []) {
          if (emph.fromAll && !line.text.includes(w)) continue;      // a word of `all` goes to the lines that have it
          lyric.push({ i: line.index, line, kind: 'emphasis', word: w });
        }
      }
      if (lyric.length) {
        const out = [];
        LH.lyricChanges(run.lctx(b, 'lyric'), lyric, run.warn, out);
        for (const c of out) run.push(Object.assign(c, { areaKey: b.key }));
      }
      for (const c of list(a.cuts)) {
        if (!isObject(c)) continue;
        const r = sentCut(run, b, c.i, c.j);
        if (r.warn) { run.warn(r.warn); continue; }
        applyEdit(run, b, cutTarget(run, r.cut), cutOnly(setFields(c, false)));
      }
    }
    if (run.mode !== 'camera') workChanges(run, b, a.work, area.kind === 'work' && allSet.season ? allSet.season.v : '');
    return res;
  }

  // The brief's lines that are still the lines it sent (b.lineTargets: [{ line, i }]); lines[i] that do not resolve
  // are warned about. A line whose answer sets its season is remembered (§5.11: no extra season change).
  function linesOfBrief(run, b, allSet, lineSets) {
    for (const s of b.brief.lines) {
      const r = sentLine(run, b, s.i);
      if (r.warn) { if (Object.keys(allSet).length && !lineSets.has(s.i)) run.warn(r.warn); continue; }
      if (!r.line) continue;
      b.lineTargets.push({ line: r.line, i: s.i });
      if ((allSet.season && b.area.kind !== 'work') || setFields(lineSets.get(s.i), false).season) run.seasonSet.add(r.line.id);
    }
    for (const l of lineSets.values()) {
      const r = sentLine(run, b, l.i);
      if (r.warn) run.warn(r.warn);
    }
  }

  // The fields a cut takes (§5.4 CUT_EDIT).
  function cutOnly(set) {
    const out = {};
    for (const k of Object.keys(set)) if (CUT_FIELDS.includes(k) || k === 'rig' || k === 'rigCurve') out[k] = set[k];
    return out;
  }

  const CUT_FIELDS = Object.freeze(CUT_PART_FIELDS.concat(['ornaments', 'speed', 'camera']));

  // The area guarantee (§5.5): every change but materials and 'outside' rows must lie in its area.
  function guard(run) {
    let dropped = 0;
    run.changes = run.changes.filter((c) => {
      if (c.kind === 'material' || c.group === 'outside' || !c.areaKey || (!c.path && !c.lineId)) return true;
      const area = run.areas.get(c.areaKey);
      let ok = false;
      if (area && c.path) ok = CH.inArea(area, c.cutKey ? 'cut/' + c.cutKey + ':' + c.slot : c.path);
      else if (area && c.lineId) ok = area.lineIds.includes(c.lineId);
      if (!ok) dropped++;
      return ok;
    });
    // dependents of a material that is not in the list any more cannot apply
    const ids = new Set(run.changes.map((c) => c.id));
    run.changes = run.changes.filter((c) => !Array.isArray(c.requires) || c.requires.every((id) => ids.has(id)));
    if (dropped) run.warn(['ai.warn.outside', { n: dropped }]);
  }

  // directChanges(doc, plan, registry, json, { rev, sent, allowMaterials, materialsBefore? }) → { results: [{ s, areaKey,
  // understood, summary, question }], changes, warnings }. Validate against the doc and plan the request was built from
  // (§5.5); change ids start with 'w<window>:'. materialsBefore: the material changes of the earlier windows of the same
  // request (they take room in doc.materials first).
  function directChanges(doc, plan, registry, json, opts) {
    const o = opts || {};
    const sent = isObject(o.sent) ? o.sent : { briefs: [] };
    const warnings = [];
    const seen = new Set();
    const warn = (w) => {
      const k = JSON.stringify(w);
      if (!seen.has(k)) { seen.add(k); warnings.push(w); }
    };
    if (!isObject(json) || !Array.isArray(json.answers)) return { results: [], changes: [], warnings: [['ai.warn.empty', {}]] };
    const shared = LH.sharedContext(doc, plan, {});
    const prefix = 'w' + (Number.isInteger(sent.window) ? sent.window : 0) + ':';
    const run = {
      doc, plan, registry, sent, prefix, warn, warnOnce: warn, mode: sent.mode === 'camera' ? 'camera' : 'all',
      briefs: list(sent.briefs), ix: shared.ix, cutByKey: shared.cutByKey,
      cutByPinKey: new Map((plan.cuts || []).map((c) => [c.pinKey || c.key, c])),
      lineById: new Map((plan.lines || []).map((l) => [l.id, l])),
      make: { rev: o.rev, prefix: '', srcs: shared.srcs }, changes: [], byPath: new Map(), alloc: new Map(), placed: new Set(),
      cutsOfLine: new Map(),
      areas: new Map(), mats: new Map(), briefCtx: new Map(), seasonSet: new Set(), allowed: new Set(), workSeason: null,
      workSeasonSet: false,
    };
    run.push = (c) => { run.changes.push(c); };
    run.lctx = (b, part) => LH.contextOf(doc, plan, registry, { rev: o.rev }, shared, b.prefix + (part ? part + ':' : ''));
    const allowMaterials = o.allowMaterials !== undefined ? !!o.allowMaterials : !!sent.allowMaterials;
    const answers = [];
    const done = new Set();
    for (const a of json.answers) {
      if (!isObject(a) || !Number.isInteger(a.s) || done.has(a.s) || !run.briefs[a.s]) continue;
      done.add(a.s);
      answers.push(a);
    }
    if (allowMaterials && run.mode !== 'camera') materialsOf(run, json.materials, o.materialsBefore);
    run.workSeason = workSeasonAfter(run, answers);
    const results = answers.map((a) => answerChanges(run, a));
    for (const mat of new Set(run.mats.values())) useChanges(run, mat);
    guard(run);
    return { results, changes: run.changes, warnings };
  }

  return {
    MAX_BRIEFS, MAX_INSTRUCTION, MAX_LINES, MEDIA_USES, directSchema, directRequests, directChanges, curveFromAi, cameraFromAi,
  };
});
