/* 文字PVメーカー v2 — original work. Inspector field catalogue: FieldSpecs per page and section, and sectionsFor (DESIGN §6.4.4–§6.4.9, §4.23). */
MV.def('ui/fields', ['core/paths', 'core/registry', 'core/schema', 'core/color', 'core/ease', 'core/doc', 'ui/selection',
  'core/curve', 'core/shot', 'core/media', 'ui/media_widgets'],
  (P, R, SC, C, E, D, S, CV, SHOT, MEDIA, MW) => {
    'use strict';

    // A FieldSpec (§4.23) is one row of the inspector: { id, path, scopes, el?, section, widget, label, hint?, basic,
    // when?(ctx) }. `path` is the slot (the text after ':'); the inspector prefixes the scope of the page (pathsFor).
    // Fields that edit the document through a command instead of a pin have `path: null` and `cmd: { t, key }`;
    // read-only derived values have `path: null` and `derived`. Additive fields: `page`, `kind`/`idx` (part widgets),
    // `spec` (the ParamSpec the widget follows), `options` (choices), `scale` (display factor), `auto` (the choice
    // offers 自動 = unpin), `labelArgs` (label params that are themselves string keys), `labelText` ({ ja, en } of a
    // generated part parameter; its `label` is 'fld.param' = '{name}'), `param` (generated part parameters),
    // `firstCut` (the line page's 切り替え: written at the line's first cut, §6.4.6), `pinnedOnly` (a pinned parameter
    // of a part that is no longer chosen, shown as 無効).

    const ALL = Object.freeze(['work', 'line', 'cut']);
    const WORK = Object.freeze(['work']);
    const LINE = Object.freeze(['line']);
    const CUT = Object.freeze(['cut']);
    const WIDGETS = Object.freeze(['part', 'choice', 'number', 'time', 'color', 'font', 'toggle', 'words', 'cutpoints',
      'text', 'slots', 'curve', 'shot', 'rig', 'partRefs', 'media', 'trim', 'crop']);
    const FACE_ROLES = Object.freeze(['display', 'serif', 'body']);
    const FACE_SCRIPTS = Object.freeze(['ja', 'latin', 'ko', 'zhHant', 'zhHans']);
    const LIST_KINDS = Object.freeze(['ornament', 'filter']);
    const SLOT_KINDS = Object.freeze(['arrange', 'arrive', 'dwell', 'depart', 'ornament', 'lens', 'filter', 'ground', 'atmos',
      'seam']);
    const TEXT_STYLES = R.TEXT_STYLES;
    const SEASONS = Object.freeze(['any', 'none', 'spring', 'summer', 'autumn', 'winter']);
    const LANGS = Object.freeze(D.LANGS.filter((l) => l !== 'auto'));
    const SNAPS = Object.freeze(['off', 'beat', 'half', 'bar']);
    const COMMANDS_USED = Object.freeze(['look.set', 'look.seed', 'meta.set', 'timing.set', 'lyrics.row']);
    const PARAM_LABEL = 'fld.param';        // '{name}': the label of a generated part parameter (name from labelText)

    // --- the slot catalogue (§3.4.1–§3.4.3): which scopes a slot is valid at --------------------------------------

    const WORK_NAMES = new Set(['mood', 'theme', 'bpm', 'beatOffset', 'readRate', 'length', 'titleCard']);
    const LINE_NAMES = new Set(['start', 'end', 'split', 'lang', 'avoid']);
    // v2.1 (DESIGN_2_1 §2.3): camerawork, motion speed and the section camera cascade cut > line > work; the line season
    // is a line value that may also be pinned for the whole video (the existing work:season).
    const CUT_NAMES = new Set(['orient', 'text.face', 'text.scale', 'text.ink', 'text.style', 'motion.speed', 'cam.shot',
      'cam.zoom', 'cam.curve', 'cam.follow', 'rig', 'rig.curve']);
    const LINE_WORK_NAMES = new Set(['season']);

    function sharedNames(kind) {
      if (kind === 'atmos') return ['amount'];
      const shared = R.SHARED[kind];
      return shared ? Object.keys(shared) : [];
    }

    function workName(slot) {
      if (WORK_NAMES.has(slot)) return true;
      const m = /^([a-z]+)\.([A-Za-z0-9]+)(?:\.([A-Za-z0-9]+))?$/.exec(slot);
      if (!m) return false;
      if (m[1] === 'color') return !m[3] && C.TOKENS.includes(m[2]);
      if (m[1] === 'amount') return !m[3] && SC.AMOUNT_KEYS.includes(m[2]);
      if (m[1] === 'face') return FACE_ROLES.includes(m[2]) && (FACE_SCRIPTS.includes(m[3]) || m[3] === 'weight');
      return false;
    }

    // slotScopes(slot) → the scope kinds where the slot may be pinned ([] when the slot is unknown or malformed).
    function slotScopes(slot) {
      let parsed;
      try { parsed = P.parse('work:' + slot); } catch (e) { return []; }
      if (parsed.el) return ALL.slice();
      if (parsed.name !== null) {
        if (workName(slot)) return WORK.slice();
        if (LINE_WORK_NAMES.has(slot)) return ['work', 'line'];
        if (LINE_NAMES.has(slot)) return LINE.slice();
        if (slot === 't0') return CUT.slice();
        return CUT_NAMES.has(slot) ? ALL.slice() : [];
      }
      return partScopes(parsed.part);
    }

    function partScopes(part) {
      if (part.kind === 'texture') return part.idx === null && part.key === null && part.param === null ? WORK.slice() : [];
      const list = LIST_KINDS.includes(part.kind);
      if (list && part.param === 'count') return part.idx === null && part.key === null ? ALL.slice() : [];
      if (list !== (part.idx !== null)) return [];
      if (part.key !== null && part.param === null) return [];
      if (part.param !== null && part.key === null && !sharedNames(part.kind).includes(part.param)) return [];
      return ALL.slice();
    }

    function fieldPath(field, scope) { return field.path ? scope + ':' + field.path : null; }

    // --- widgets for parameter specs ----------------------------------------------------------------------------

    // widgetFor(ParamSpec) → the widget that edits it (§6.4.4: every registry param maps to a widget).
    function widgetFor(spec) {
      switch (spec && spec.type) {
        case 'num': case 'int': return 'number';
        case 'bool': return 'toggle';
        case 'enum': case 'ease': case 'order': case 'face': return 'choice';
        // v2.1 (DESIGN_2_1 §3.14): the curve widget (ui/curve_widget), shot tiles, the section-camera select and part
        // chips; a photo or video (§11.2.3) the media widget (ui/media_widgets: poster, name, badges → the picker).
        case 'curve': return 'curve';
        case 'shot': return 'shot';
        case 'rig': return 'rig';
        case 'partRefs': return 'partRefs';
        case 'media': return 'media';
        case 'ink': case 'color': return 'color';
        case 'text': return 'text';
        case 'nudge': return 'number';
        default: return null;
      }
    }

    // Choice options for a spec: [{ v, label | text | labelArgs }]. Option labels are string keys; values that are
    // their own label (aspects, numbers) use `text`. An enum whose values need their own words (depth's 'back' is not
    // opt.back 逆方向) names a key group with `optKey`: its labels are opt.<optKey>.<value>.
    function optionsFor(spec) {
      switch (spec && spec.type) {
        case 'enum': return spec.of.map((v) => (typeof v === 'number' ? { v, text: String(v) }
          : { v, label: 'opt.' + (spec.optKey ? spec.optKey + '.' : '') + v, fallback: String(v) }));
        case 'ease': return E.EASES.map((v) => easeOption(v));
        case 'curve': return Object.keys(CV.PRESETS).map((v) => ({ v, label: 'curve.' + v })).concat(E.EASES.map((v) => easeOption(v)));
        case 'shot': return ['none'].concat(SHOT.SHOT_KEYS).map((v) => ({ v, label: 'shot.' + v }));
        case 'rig': return ['none'].concat(SHOT.RIG_KEYS).map((v) => ({ v, label: 'rig.' + v }));
        case 'order': return SC.ORDERS.map((v) => ({ v, label: 'opt.order.' + v }));
        case 'face': return FACE_ROLES.map((v) => ({ v, label: 'fld.faceRole.' + v }));
        default: return [];
      }
    }

    function easeOption(v) {
      const m = /^(linear|steps|[a-z]+?)(InOut|In|Out)?$/.exec(v);
      if (!m || !m[2]) return { v, label: 'opt.ease.' + v };
      return { v, label: 'opt.ease', labelArgs: { family: 'opt.ease.' + m[1], dir: 'opt.easeDir.' + m[2] } };
    }

    // --- builders -----------------------------------------------------------------------------------------------

    function F(o) {
      const f = Object.assign({ scopes: ALL, basic: true, path: null }, o);
      if (!f.key) f.key = f.path || (f.cmd ? f.cmd.t + '.' + f.cmd.key : f.derived);
      return f;
    }
    function sec(id, open, fields, extra) { return Object.assign({ id, open, fields }, extra || {}); }
    const opts = (values, prefix) => values.map((v) => ({ v, label: prefix + v }));
    const sharedSpec = (kind, name) => R.SHARED[kind === 'atmos' ? 'ground' : kind][name];
    const enumSpec = (of) => ({ type: 'enum', of });

    const SPEC = {
      scale: { type: 'num', min: 0.5, max: 2, step: 0.01, unit: 'x' },
      ink: { type: 'ink' },
      color: { type: 'color' },
      weight: { type: 'int', min: 100, max: 900, step: 100 },
      unit: { type: 'num', min: 0, max: 1, step: 0.01 },
      bpm: { type: 'num', min: 40, max: 240, step: 0.1, unit: '' },
      offset: { type: 'num', min: 0, max: 4, step: 0.001, unit: 's' },
      readRate: { type: 'num', min: 3, max: 14, step: 0.1, unit: '' },
      count: { type: 'int', min: 0, max: 3, step: 1 },
      seed: { type: 'int', min: 0, max: 4294967295, step: 1 },
      timing: { type: 'num', min: 0, max: 10, step: 0.01, unit: 's' },
      nudge: { type: 'nudge' },
      text: { type: 'text', max: 200 },
      family: { type: 'text', max: 80 },
      // v2.1 cut slots (DESIGN_2_1 §2.3, planner/camera.SLOT_SPECS): shown ×100 as percentages.
      speed: { type: 'num', min: 0.25, max: 4, step: 0.05, unit: 'pct' },
      camZoom: { type: 'num', min: 0.5, max: 2, step: 0.01, unit: 'pct' },
      follow: { type: 'num', min: 0, max: 1, step: 0.01, unit: 'pct' },
      curve: { type: 'curve' },
      shot: { type: 'shot' },
      rig: { type: 'rig' },
      partRefs: { type: 'partRefs' },
    };

    // Shared-parameter rows written out by name (the line page lists them, §6.4.6).
    function sharedField(kind, name, label, extra) {
      const spec = sharedSpec(kind, name);
      return F(Object.assign({ path: kind + '.' + name, widget: widgetFor(spec), label, spec }, extra || {}));
    }

    function partField(kind, label, extra) {
      return F(Object.assign({ path: kind, widget: 'part', kind, label }, extra || {}));
    }

    function listFields(kind, i) {
      const when = (ctx) => ctx.idx === i;
      const owner = kind + '#' + i;
      const out = [partField(kind, 'fld.kindOf', { path: owner, idx: i, when, noneOk: true })];
      if (kind === 'ornament') {
        out.push(F({ path: 'el.' + owner + '.hide', widget: 'toggle', label: 'fld.hide', when }),
          F({ path: 'el.' + owner + '.nudge', widget: 'number', label: 'fld.nudge', spec: SPEC.nudge, when, basic: false }));
      }
      return out;
    }

    // Face rows only for scripts in use (ja and latin always).
    const faceWhen = (script) => (ctx) => script === 'ja' || script === 'latin' || ctx.scripts.has(script);
    const faceFields = [];
    for (const role of FACE_ROLES) {
      for (const script of FACE_SCRIPTS) {
        faceFields.push(F({ path: 'face.' + role + '.' + script, scopes: WORK, widget: 'font', label: 'fld.faceOf',
          labelArgs: { role: 'fld.faceRole.' + role, script: 'fld.script.' + script }, spec: SPEC.family, script, role,
          when: faceWhen(script) }));
      }
    }
    for (const role of FACE_ROLES) {
      faceFields.push(F({ path: 'face.' + role + '.weight', scopes: WORK, widget: 'number', label: 'fld.faceWeight',
        labelArgs: { role: 'fld.faceRole.' + role }, spec: SPEC.weight, basic: false }));
    }

    const textFaceField = (extra) => F(Object.assign({ path: 'text.face', widget: 'choice', label: 'fld.textFace',
      spec: { type: 'face' }, options: optionsFor({ type: 'face' }) }, extra || {}));
    const textInkField = () => F({ path: 'text.ink', widget: 'color', label: 'fld.textInk', spec: SPEC.ink });
    const textStyleField = () => F({ path: 'text.style', widget: 'choice', label: 'fld.textStyle', spec: enumSpec(TEXT_STYLES),
      options: opts(TEXT_STYLES, 'fld.style.') });
    const textScaleField = (label) => F({ path: 'text.scale', widget: 'number', label: label || 'fld.textScale', spec: SPEC.scale });
    const orientField = () => F({ path: 'orient', widget: 'choice', label: 'fld.orient', spec: enumSpec(['h', 'v']),
      options: opts(['h', 'v'], 'fld.orient.'), auto: true, when: (ctx) => ctx.orients.includes('v') || ctx.scopeKind === 'work' });

    // 要素 › 文字 › 文字の中に写真・動画 (DESIGN_2_1 §11.7.4): a shortcut to the first textFill ornament slot of the page's
    // scope — its picture (the media widget; choosing one also pins the textFill part there), its fit and its crop. The
    // slot is ctx.textFillIdx (0–2); the fit and crop rows show once the slot holds textFill.
    function textMediaFields() {
      const out = [];
      for (let i = 0; i < 3; i++) {
        const slot = 'ornament#' + i;
        const media = Object.freeze({ kind: 'ornament', idx: i, key: 'textFill', src: 'src', slot });
        const at = (ctx) => ctx.textFillIdx === i;
        const on = (ctx) => ctx.textFillIdx === i && ctx.textFillOn;
        out.push(F({ path: slot + '@textFill.src', widget: 'media', label: 'fld.textMedia', spec: { type: 'media', accept: 'any' },
          textFill: i, media, when: at }));
        out.push(F({ path: slot + '@textFill.fit', widget: 'choice', label: 'fld.fit', spec: enumSpec(MEDIA.FITS.slice()), media, when: on }));
        out.push(F({ path: slot + '@textFill.cropZoom', widget: 'crop', label: 'fld.crop', media, scale: 100, when: on,
          spec: { type: 'num', min: MEDIA.LIMITS.params.cropZoom[0], max: MEDIA.LIMITS.params.cropZoom[1], step: MEDIA.LIMITS.params.cropZoom[2], unit: 'x' } }));
      }
      return out;
    }

    const isInnerCut = (ctx) => !!(ctx.cut && ctx.cut.line && P.cutOffset(ctx.cut.key) > 0);
    const isRole = (role) => (ctx) => !!(ctx.cut && ctx.cut.role === role);

    // v2.1 rows (DESIGN_2_1 §6.5): motion speed, camerawork and its closeness / curve / follow, the section camera.
    const speedField = () => F({ path: 'motion.speed', widget: 'number', label: 'fld.motionSpeed', spec: SPEC.speed, scale: 100 });
    const shotField = () => F({ path: 'cam.shot', widget: 'shot', label: 'fld.camShot', spec: SPEC.shot, kind: 'shot' });
    const rigFields = () => [
      F({ path: 'rig', widget: 'rig', label: 'fld.rig', spec: SPEC.rig, auto: true, select: true }),
      F({ path: 'rig.curve', widget: 'curve', label: 'fld.rigCurve', spec: SPEC.curve }),
    ];
    const lineSeasonField = () => F({ path: 'season', scopes: LINE, widget: 'choice', label: 'fld.lineSeason', spec: enumSpec(SEASONS),
      options: opts(SEASONS, 'fld.season.'), auto: true, select: true, basic: false });
    const avoidField = () => F({ path: 'avoid', scopes: LINE, widget: 'partRefs', label: 'fld.avoid', spec: SPEC.partRefs, basic: false });
    const hasArea = (ctx) => !!ctx.area;

    // --- pages ----------------------------------------------------------------------------------------------------

    const PAGES = {
      work: [
        sec('look', true, [
          partField('mood', 'kind.mood', { scopes: WORK }),
          partField('theme', 'kind.theme', { scopes: WORK }),
          F({ path: 'season', scopes: WORK, widget: 'choice', label: 'fld.season', spec: enumSpec(SEASONS),
            options: opts(SEASONS, 'fld.season.'), auto: true }),
          F({ cmd: { t: 'look.set', key: 'aspect' }, scopes: WORK, widget: 'choice', label: 'look.shape',
            options: D.ASPECTS.map((v) => ({ v, text: v })), select: true }),
          F({ cmd: { t: 'look.set', key: 'backdrop' }, scopes: WORK, widget: 'choice', label: 'fld.backdrop',
            options: opts(D.BACKDROPS, 'exp.bg.'), select: true }),
        ]),
        // 写真・動画 (DESIGN_2_1 §11.7.3): the library, open when it holds something.
        sec('media', (ctx) => ctx.mediaCount > 0, [], { custom: 'media' }),
        sec('colors', false, C.TOKENS.map((tok) => F({ path: 'color.' + tok, scopes: WORK, widget: 'color',
          label: 'fld.color.' + tok, spec: SPEC.color })), { custom: 'colorsReset' }),
        sec('type', false, faceFields.concat([textScaleField('fld.textScaleAll')]), { custom: 'fontBanner', customTop: true }),
        sec('energy', true, SC.AMOUNT_KEYS.map((k) => F({ path: 'amount.' + k, scopes: WORK,
          widget: k === 'flash' ? 'toggle' : 'number', label: 'fld.amount.' + k, spec: SPEC.unit, scale: 100,
          flashToggle: k === 'flash' })), { custom: 'amountsReset' }),
        sec('parts', false, [], { custom: 'parts' }),
        sec('title', false, [
          F({ cmd: { t: 'meta.set', key: 'title' }, scopes: WORK, widget: 'text', label: 'fld.title', spec: SPEC.text }),
          F({ cmd: { t: 'meta.set', key: 'artist' }, scopes: WORK, widget: 'text', label: 'fld.artist', spec: SPEC.text }),
          F({ path: 'titleCard', scopes: WORK, widget: 'choice', label: 'fld.titleCard', spec: { type: 'bool' },
            options: [{ v: true, label: 'fld.titleCard.on' }, { v: false, label: 'fld.titleCard.off' }], auto: true }),
        ], { custom: 'titleLink' }),
        sec('timing', false, [
          F({ path: 'readRate', scopes: WORK, widget: 'number', label: 'fld.readRate', spec: SPEC.readRate }),
          F({ cmd: { t: 'timing.set', key: 'snap' }, scopes: WORK, widget: 'choice', label: 'song.snap',
            options: opts(SNAPS, 'fld.snap.') }),
          F({ cmd: { t: 'timing.set', key: 'lead' }, scopes: WORK, widget: 'number', label: 'fld.lead', spec: SPEC.timing }),
          F({ cmd: { t: 'timing.set', key: 'tail' }, scopes: WORK, widget: 'number', label: 'fld.tail', spec: SPEC.timing }),
          F({ cmd: { t: 'timing.set', key: 'leadIn' }, scopes: WORK, widget: 'number', label: 'fld.leadIn', spec: SPEC.timing }),
          F({ cmd: { t: 'timing.set', key: 'outro' }, scopes: WORK, widget: 'number', label: 'fld.outro', spec: SPEC.timing }),
          F({ path: 'length', scopes: WORK, widget: 'time', label: 'fld.length' }),
          F({ path: 'bpm', scopes: WORK, widget: 'number', label: 'song.tempo', spec: SPEC.bpm }),
          F({ path: 'beatOffset', scopes: WORK, widget: 'number', label: 'fld.beatOffset', spec: SPEC.offset, basic: false }),
          F({ cmd: { t: 'timing.set', key: 'tapLatency' }, scopes: WORK, widget: 'number', label: 'fld.tapLatency',
            spec: SPEC.timing, basic: false }),
        ]),
        sec('lines', false, [], { custom: 'lines' }),
        sec('looks', false, [], { custom: 'looks' }),
        sec('defaults', false, [
          partField('texture', 'fld.texture', { scopes: WORK, noneOk: true, texture: true, partKind: 'filter' }),
        ], { custom: 'elements' }),
        sec('other', false, [
          F({ cmd: { t: 'look.seed', key: 'seed' }, scopes: WORK, widget: 'number', label: 'fld.seed', spec: SPEC.seed }),
        ], { custom: 'other' }),
        // マイ素材 (DESIGN_2_1 §6.9): collapsed, and only when the project has materials.
        sec('materials', false, [], { custom: 'materials', when: (ctx) => ctx.materials > 0 }),
      ],
      line: [
        sec('time', true, [
          F({ path: 'start', scopes: LINE, widget: 'time', label: 'fld.start' }),
          F({ path: 'end', scopes: LINE, widget: 'time', label: 'fld.end' }),
          F({ derived: 'lineLength', scopes: LINE, widget: 'time', label: 'fld.duration', readOnly: true }),
        ]),
        sec('marks', true, [
          F({ cmd: { t: 'lyrics.row', key: 'emph' }, scopes: LINE, widget: 'words', label: 'fld.emph' }),
          F({ cmd: { t: 'lyrics.row', key: 'impact' }, scopes: LINE, widget: 'toggle', label: 'fld.impact' }),
          F({ path: 'split', scopes: LINE, widget: 'cutpoints', label: 'fld.split' }),
          F({ cmd: { t: 'lyrics.row', key: 'note' }, scopes: LINE, widget: 'text', label: 'fld.note', spec: SPEC.text }),
          F({ path: 'lang', scopes: LINE, widget: 'choice', label: 'fld.lang', spec: enumSpec(LANGS),
            options: opts(LANGS, 'lang.'), auto: true, select: true, basic: false }),
        ], { custom: 'lockPartial', customTop: true }),
        sec('direction', true, directionFields()),
        sec('colortype', false, [textFaceField(), textInkField(), textStyleField(), textScaleField()]),
        sec('cuts', false, [], { custom: 'cuts', when: (ctx) => !!ctx.line && ctx.line.cuts.length > 1 }),
        sec('elements', false, [], { custom: 'elements' }),
        sec('ai', false, [], { custom: 'ai' }),
      ],
      lines: [
        sec('multi', true, [], { custom: 'multi' }),
        sec('direction', true, directionFields()),
        // An area selection (区画, DESIGN_2_1 §6.5) adds its section camera; its runs are split at the area's edges.
        sec('rig', true, rigFields(), { when: hasArea }),
        sec('colortype', false, [textFaceField(), textInkField(), textStyleField(), textScaleField()]),
        sec('shift', true, [], { custom: 'shift' }),
      ],
      cut: [
        sec('time', true, [
          F({ path: 't0', scopes: CUT, widget: 'time', label: 'fld.cutStart', when: isInnerCut }),
          F({ derived: 'cutEnd', scopes: CUT, widget: 'time', label: 'fld.cutEnd', readOnly: true, when: (ctx) => !!ctx.cut }),
        ]),
        sec('titletext', true, [
          F({ cmd: { t: 'meta.set', key: 'title' }, scopes: CUT, widget: 'text', label: 'fld.title', spec: SPEC.text, when: isRole('title') }),
          F({ cmd: { t: 'meta.set', key: 'artist' }, scopes: CUT, widget: 'text', label: 'fld.artist', spec: SPEC.text, when: isRole('title') }),
        ]),
        sec('gaplabel', true, [
          F({ path: 'arrange@breathMark.label', scopes: CUT, widget: 'text', label: 'fld.gapLabel', spec: { type: 'text', max: 40 },
            presets: [{ v: 'none', label: 'fld.gapLabel.none' }, { v: '♪', text: '♪' }, { v: 'heading', label: 'fld.gapLabel.heading' }],
            when: isRole('interlude') }),
        ]),
        sec('layout', true, [partField('arrange', 'kind.arrange'),
          F({ path: 'el.text.nudge', widget: 'number', label: 'fld.nudge', spec: SPEC.nudge }), textScaleField()]),
        sec('motion', true, [partField('arrive', 'kind.arrive'), partField('dwell', 'kind.dwell'), partField('depart', 'kind.depart'),
          speedField()]),
        sec('seam', true, [partField('seam', 'kind.seam')]),
        sec('elements', true, [], { custom: 'elements' }),
        sec('ai', false, [], { custom: 'ai', when: (ctx) => !!(ctx.cut && ctx.cut.line) }),
      ],
      'el.text': [
        sec('text', true, [textFaceField(), textScaleField(), textInkField(),
          F({ path: 'el.text.fill', widget: 'color', label: 'fld.emphInk', spec: SPEC.ink }), textStyleField(), orientField(),
          F({ path: 'el.text.nudge', widget: 'number', label: 'fld.nudgeFull', spec: SPEC.nudge }),
          F({ path: 'el.text.hide', widget: 'toggle', label: 'fld.hide' }),
          sharedField('arrive', 'order', 'fld.order'), sharedField('arrive', 'each', 'fld.each')].concat(textMediaFields())),
        sec('tune', false, [], { params: [{ kind: 'arrange' }, { kind: 'arrive' }, { kind: 'dwell' }, { kind: 'depart' }] }),
      ],
      'el.ornament': [
        sec('list', true, [F({ path: 'ornament.count', widget: 'number', label: 'fld.count', spec: SPEC.count }),
          F({ key: 'ornament.list', derived: 'slots', widget: 'slots', label: 'fld.slots', kind: 'ornament' })]),
        sec('slot', true, [0, 1, 2].flatMap((i) => listFields('ornament', i)), { labelOf: 'crumb.ornament' }),
      ],
      'el.ground': [
        sec('ground', true, [partField('ground', 'kind.ground')], { custom: 'groundRun' }),
        sec('atmos', true, [partField('atmos', 'fld.atmos', { noneOk: true, partKind: 'ornament', run: true })]),
      ],
      // 要素 › カメラ (DESIGN_2_1 §6.5): the shot of the cut, the lens texture, and the section camera of the run.
      'el.lens': [
        sec('camwork', true, [shotField(),
          F({ path: 'cam.zoom', widget: 'number', label: 'fld.camZoom', spec: SPEC.camZoom, scale: 100 }),
          F({ path: 'cam.curve', widget: 'curve', label: 'fld.camCurve', spec: SPEC.curve }),
          F({ path: 'cam.follow', widget: 'number', label: 'fld.camFollow', spec: SPEC.follow, scale: 100, basic: false }),
        ], { custom: 'camKeys' }),
        sec('camtexture', true, [partField('lens', 'fld.lensMove'), sharedField('lens', 'curve', 'fld.lensCurve', { basic: false })]),
        sec('rig', false, rigFields(), { custom: 'rigRun', customTop: true }),
      ],
      'el.filter': [
        sec('list', true, [F({ path: 'filter.count', widget: 'number', label: 'fld.count', spec: SPEC.count }),
          F({ key: 'filter.list', derived: 'slots', widget: 'slots', label: 'fld.slots', kind: 'filter' })], { custom: 'backdropNote' }),
        sec('slot', true, [0, 1, 2].flatMap((i) => listFields('filter', i)), { labelOf: 'crumb.filter' }),
        sec('workfx', true, [
          partField('texture', 'fld.texture', { scopes: WORK, noneOk: true, texture: true, partKind: 'filter' }),
          F({ path: 'amount.flash', scopes: WORK, widget: 'toggle', label: 'fld.amount.flash', spec: SPEC.unit, flashToggle: true }),
        ]),
      ],
      'el.seam': [sec('seam', true, [partField('seam', 'kind.seam', { scopes: CUT })])],
    };

    // 行 › 演出 (§6.4.6; DESIGN_2_1 §6.5): 緩急 after 入り and 抜け (the curve widget), 動きの速さ, カメラワーク; advanced:
    // 出方の緩急, この行の季節, この行で使わない部品.
    function directionFields() {
      return [
        partField('arrange', 'kind.arrange'),
        partField('arrive', 'kind.arrive'),
        sharedField('arrive', 'dur', 'fld.dur'), sharedField('arrive', 'ease', 'fld.speedCurve'),
        sharedField('arrive', 'order', 'fld.order'), sharedField('arrive', 'each', 'fld.each'),
        sharedField('arrive', 'flow', 'fld.flow', { basic: false }),
        partField('dwell', 'kind.dwell'), sharedField('dwell', 'amount', 'fld.amount'),
        partField('depart', 'kind.depart'), sharedField('depart', 'dur', 'fld.dur'), sharedField('depart', 'ease', 'fld.speedCurve'),
        speedField(), shotField(),
        // §6.4.6: the transition into the line's first cut (a line-scope seam pin would change every cut boundary).
        partField('seam', 'fld.seamIntoLine', { firstCut: true }),
        orientField(),
        lineSeasonField(), avoidField(),
      ];
    }

    // Choice options are filled from the spec where the page does not list them.
    function finish(field, page, section) {
      const f = Object.assign({}, field, { page, section });
      if (f.widget === 'choice' && !f.options) f.options = optionsFor(f.spec);
      f.id = page + '/' + section + '/' + f.key;
      return Object.freeze(f);
    }

    const PAGE_SECTIONS = {};
    const FIELDS = [];
    for (const page of Object.keys(PAGES)) {
      PAGE_SECTIONS[page] = PAGES[page].map((s) => {
        const fields = s.fields.map((f) => finish(f, page, s.id));
        FIELDS.push(...fields);
        return Object.freeze(Object.assign({}, s, { fields }));
      });
    }
    Object.freeze(FIELDS);

    // --- context of a selection -----------------------------------------------------------------------------------

    const SCRIPT_OF = { ja: 'ja', en: 'latin', ko: 'ko', zhHant: 'zhHant', zhHans: 'zhHans' };

    // An area selection (sel.area, DESIGN_2_1 §5.1) is shown on the several-lines page, even with one line: its header
    // names the area and it carries the area's own rows.
    function pageOf(sel, plan) {
      const s = S.validate(sel, plan);
      if (s.level === 'work') return 'work';
      if (s.level === 'line') return s.ids.length > 1 || s.area ? 'lines' : 'line';
      if (s.level === 'cut') return 'cut';
      return 'el.' + s.el;
    }

    // contextOf(sel, plan, registry, doc?) → what sectionsFor and the inspector need about a selection. `doc` (optional)
    // gives the material count of the work page.
    function contextOf(sel, plan, registry, doc) {
      const s = S.validate(sel, plan);
      const page = pageOf(s, plan);
      const cutsAll = plan && Array.isArray(plan.cuts) ? plan.cuts : [];
      const linesAll = plan && Array.isArray(plan.lines) ? plan.lines : [];
      const scope = page === 'lines' ? 'line/' + s.ids[0] : S.scopeOf(s, plan);
      const scopeKind = scope === 'work' ? 'work' : scope.startsWith('line/') ? 'line' : 'cut';
      let keys;
      if (page === 'lines') keys = S.cutsOf(s, plan);
      else if (scopeKind === 'work') keys = cutsAll.map((c) => c.key);
      else if (scopeKind === 'line') keys = (linesAll.find((l) => l.id === scope.slice(5)) || { cuts: [] }).cuts;
      else keys = [scope.slice(4)];
      const byKey = new Map(cutsAll.map((c) => [c.key, c]));
      const cuts = keys.map((k) => byKey.get(k)).filter(Boolean);
      const lineIds = page === 'lines' ? s.ids.slice() : scopeKind === 'line' ? [scope.slice(5)] : [];
      const line = lineIds.length === 1 ? linesAll.find((l) => l.id === lineIds[0]) || null : null;
      const scripts = new Set(linesAll.map((l) => SCRIPT_OF[l.lang]).filter(Boolean));
      const orients = [...new Set(cuts.flatMap((c) => (c.feat && Array.isArray(c.feat.orients) ? c.feat.orients : ['h'])))];
      const mats = doc && doc.materials && Array.isArray(doc.materials.list) ? doc.materials.list.length : 0;
      const ctx = {
        sel: s, page, scope, scopeKind, plan: plan || null, registry: registry || null, cuts, cutKeys: keys, lineIds, line,
        cut: scopeKind === 'cut' ? byKey.get(scope.slice(4)) || null : null, idx: s.level === 'el' ? s.idx || 0 : null,
        el: s.level === 'el' ? s.el : null, scripts, orients, area: s.level === 'line' && s.area ? s.area : null,
        materials: mats, mediaCount: doc && doc.media && Array.isArray(doc.media.list) ? doc.media.list.length : 0,
        textFillIdx: null, textFillOn: false,
      };
      if (page === 'el.text') {
        // the slot 文字の中に写真・動画 manages: the first that shows textFill, else the first free one (§5.5)
        let at = [0, 1, 2].find((i) => agreedKey(ctx, 'ornament#' + i) === 'textFill');
        ctx.textFillOn = at !== undefined;
        if (at === undefined) at = doc ? freeIndex(doc, plan, scope, 'ornament') : 0;
        ctx.textFillIdx = at === null ? null : at;
      }
      return ctx;
    }

    // freeIndex(doc, plan, scope, kind) → the ornament#i / filter#i of a scope a new part goes to: one that no user or
    // lock pin holds (on the scope itself, on its line for a cut, on its cuts for a line: the §5.5 rule), and of those
    // the one where the fewest cuts of the scope change. A cut changes when the slot shows an automatic part there (it
    // would be replaced) or when its count is below i (the planner raises the count to reach a pinned slot, §3.4.3, and
    // adds automatic parts in between). Ties go to the slot that replaces fewer parts, then the lower one. null when all
    // three are held.
    function freeIndex(doc, plan, scope, kind) {
      const k = kind || 'ornament';
      const busy = (path) => !!doc.pins[path] && doc.pins[path].by !== 'ai';
      const cuts = plan && Array.isArray(plan.cuts) ? plan.cuts : [];
      const mine = scope === 'work' ? cuts : scope.startsWith('line/') ? cuts.filter((c) => c.line === scope.slice(5))
        : [cutByKey(plan, scope.slice(4))].filter(Boolean);
      const shows = (c, i) => !!c.slots && !!c.slots[k + '#' + i] && c.slots[k + '#' + i].v !== 'none';
      const countOf = (c) => {
        const d = c.slots ? c.slots[k + '.count'] : null;
        return d && Number.isInteger(d.v) ? d.v : [0, 1, 2].filter((i) => shows(c, i)).length;
      };
      let best = null;
      for (let i = 0; i < 3; i++) {
        const slot = k + '#' + i;
        const paths = [writePath(scope + ':' + slot, plan)];
        if (scope.startsWith('line/')) for (const c of mine) paths.push('cut/' + (c.pinKey || c.key) + ':' + slot);
        if (scope.startsWith('cut/')) { const c = mine[0]; if (c && c.line) paths.push('line/' + c.line + ':' + slot); }
        if (paths.some(busy)) continue;
        const replaced = mine.filter((c) => shows(c, i)).length;
        const cost = replaced + mine.filter((c) => !shows(c, i) && countOf(c) < i).length;
        if (!best || cost < best.cost || (cost === best.cost && replaced < best.replaced)) best = { i, cost, replaced };
      }
      return best ? best.i : null;
    }

    // The part chosen for a slot across the context's cuts, when every cut agrees; null when mixed or unknown.
    function decisionsOf(ctx, slot) {
      const plan = ctx.plan;
      if (!plan) return [];
      if (slot === 'ground' || slot === 'atmos') {
        const grounds = Array.isArray(plan.grounds) ? plan.grounds : [];
        return ctx.cuts.map((c) => grounds[c.ground]).filter(Boolean).map((g) => g[slot]).filter(Boolean);
      }
      if (slot === 'seam') {
        const seams = Array.isArray(plan.seams) ? plan.seams : [];
        return ctx.cuts.map((c) => {
          const s = seams.find((x) => x.into === c.key);
          return s ? s.slot : { v: fallbackKey(ctx.registry, 'seam'), from: 'auto' };
        });
      }
      return ctx.cuts.map((c) => (c.slots ? c.slots[slot] : null)).filter(Boolean);
    }

    function fallbackKey(registry, kind) {
      try { return registry ? registry.fallback(kind) : null; } catch (e) { return null; }
    }

    function agreedKey(ctx, slot) {
      const list = decisionsOf(ctx, slot);
      if (!list.length) return null;
      const v = list[0].v;
      return list.every((d) => d.v === v) && typeof v === 'string' && v !== 'none' ? v : null;
    }

    // paramFields(kind, idx, partKey, registry, { shared, part, section, scopes }) → generated FieldSpecs for the
    // parameters of a part (shared ones by `kind.param`, own ones by `kind@key.param`). partKey null → shared only.
    function paramFields(kind, idx, partKey, registry, o) {
      const opt = o || {};
      const regKind = kind === 'atmos' ? 'ornament' : kind;
      let list = partKey && registry && typeof registry.params === 'function' ? registry.params(regKind, partKey) : null;
      if (!list) {
        const shared = R.SHARED[regKind] || {};
        list = Object.keys(shared).map((name) => ({ name, spec: shared[name], shared: true }));
      }
      if (kind === 'atmos') list = list.filter((p) => !p.shared || p.name === 'amount');
      const out = [];
      for (const p of list) {
        if (p.shared ? opt.shared === false : opt.part === false) continue;
        const slot = P.slotParamPath(kind, idx === undefined ? null : idx, p.shared ? null : partKey, p.name, p.shared);
        out.push(Object.freeze({
          id: (opt.page || 'param') + '/' + (opt.section || 'param') + '/' + slot, key: slot, path: slot,
          scopes: opt.scopes || ALL, section: opt.section || null, page: opt.page || null, widget: widgetFor(p.spec),
          label: PARAM_LABEL, labelText: p.spec.label || { ja: p.name, en: p.name }, basic: p.spec.ui !== 'advanced',
          spec: p.spec, options: widgetFor(p.spec) === 'choice' ? optionsFor(p.spec) : undefined,
          param: Object.freeze({ kind, idx: idx === undefined ? null : idx, key: p.shared ? null : partKey, name: p.name, shared: p.shared }),
          generated: true,
        }));
      }
      return out;
    }

    // The first cut of every line of the context (the cuts a firstCut field covers).
    function firstCuts(ctx) {
      const lines = ctx.plan && Array.isArray(ctx.plan.lines) ? ctx.plan.lines : [];
      const byKey = new Map(ctx.cuts.map((c) => [c.key, c]));
      return ctx.lineIds.map((id) => {
        const line = lines.find((l) => l.id === id);
        return line && line.cuts.length ? byKey.get(line.cuts[0]) : null;
      }).filter(Boolean);
    }

    const withFlags = (g, flags) => (Object.keys(flags).length ? Object.freeze(Object.assign({}, g, flags)) : g);

    // Generated parameter rows go right after their part row; rows the page already lists are not repeated.
    function expand(section, fields, ctx, pageSlots) {
      const out = [];
      for (const f of fields) {
        out.push(f);
        if (f.widget !== 'part' || !SLOT_KINDS.includes(f.kind)) continue;
        const idx = f.idx === undefined ? null : f.idx;
        const key = agreedKey(f.firstCut ? Object.assign({}, ctx, { cuts: firstCuts(ctx) }) : ctx, f.path);
        // a part with a photo or video param gets the media rows (ui/media_widgets: source, depth, crop, video rows)
        const gen = MW.mediaRows(paramFields(f.kind, idx, key, ctx.registry, { section: section.id, page: ctx.page, scopes: f.scopes }));
        const flags = f.firstCut ? { firstCut: true } : {};
        for (const g of gen) {
          if (pageSlots.has(g.path) || (g.when && !g.when(ctx))) continue;
          out.push(withFlags(g, flags));
          pageSlots.add(g.path);
          if (g.trimOut) pageSlots.add(g.trimOut);
        }
      }
      for (const want of section.params || []) {
        const key = agreedKey(ctx, want.kind);
        if (!key) continue;
        const gen = paramFields(want.kind, null, key, ctx.registry, { shared: false, section: section.id, page: ctx.page });
        for (const g of gen) if (!pageSlots.has(g.path)) { out.push(Object.assign({ group: want.kind }, g)); pageSlots.add(g.path); }
      }
      return out;
    }

    // sectionsFor(sel, plan, registry, doc?) → [{ id, label, open, fields, custom }] for the page of the selection
    // (§6.4.5–§6.4.9). Fields are filtered by the page scope and their `when`; part rows are followed by their parameters.
    function sectionsFor(sel, plan, registry, doc) {
      const ctx = contextOf(sel, plan, registry, doc);
      const visible = (f) => f.scopes.includes(ctx.scopeKind) && (!f.when || f.when(ctx));
      const pageSlots = new Set();
      const sections = PAGE_SECTIONS[ctx.page].filter((s) => !s.when || s.when(ctx)).map((s) => {
        const fields = s.fields.filter(visible);
        for (const f of fields) if (f.path) pageSlots.add(f.path);
        return { s, fields };
      });
      const out = [];
      for (const { s, fields } of sections) {
        const all = expand(s, fields, ctx, pageSlots);
        const video = all.filter((f) => f.video);
        // 空気（粒子） that shows a photo or video layer reads 重ねる映像 (DESIGN_2_1 §11.7.3 use 重ねる映像)
        const overlay = s.id === 'atmos' && agreedKey(ctx, 'atmos') === 'mediaLayer';
        out.push({
          id: s.id,
          label: s.labelOf ? [s.labelOf, { k: (ctx.idx || 0) + 1 }] : [overlay ? 'sec.overlay' : 'sec.' + s.id, {}],
          open: typeof s.open === 'function' ? !!s.open(ctx) : s.open,
          custom: s.custom || null,
          customTop: !!s.customTop,
          params: s.params || null,
          fields: video.length ? all.filter((f) => !f.video) : all,
        });
        // ▾ 動画 (DESIGN_2_1 §11.7.4): the video rows of a media part follow its section, under an id of their own
        // ('video' after 背景, 'video.atmos' after 重ねる映像: each keeps its own open state).
        if (video.length) {
          out.push({ id: s.id === 'ground' ? 'video' : 'video.' + s.id, label: ['sec.video', {}], open: true, custom: null, customTop: false,
            params: null, fields: video });
        }
      }
      return out.filter((s) => s.custom || s.fields.length);
    }

    // --- the paths a row writes -------------------------------------------------------------------------------------

    // The scope of a line's first cut; a one-cut line keeps its line scope (its cut fields merge into the line page).
    function firstCutScope(ctx, lineId) {
      const lines = ctx.plan && Array.isArray(ctx.plan.lines) ? ctx.plan.lines : [];
      const line = lines.find((l) => l.id === lineId);
      return line && line.cuts.length > 1 ? 'cut/' + line.cuts[0] : 'line/' + lineId;
    }

    // pathsFor(field, ctx) → the full paths a row writes: the page scope; every selected line on the several-lines
    // page; the first cut of the line(s) for firstCut fields.
    function pathsFor(field, ctx) {
      if (!field.path) return [];
      if (field.firstCut && ctx.lineIds.length) return ctx.lineIds.map((id) => firstCutScope(ctx, id) + ':' + field.path);
      if (ctx.page === 'lines') return ctx.lineIds.map((id) => 'line/' + id + ':' + field.path);
      return [ctx.scope + ':' + field.path];
    }

    // clearPathsFor(field, ctx) → the paths × / Del may clear: pathsFor, plus (firstCut fields) the line-scope pin of
    // the same slot, which also reaches the first cut and could not be removed from anywhere else, plus the paths the
    // pins really live at when a cut keeps them under an older key (writePath).
    function clearPathsFor(field, ctx) {
      const out = pathsFor(field, ctx);
      if (field.firstCut) {
        for (const id of ctx.lineIds) {
          const p = 'line/' + id + ':' + field.path;
          if (!out.includes(p)) out.push(p);
        }
      }
      for (const p of out.slice()) {
        const w = writePath(p, ctx.plan);
        if (!out.includes(w)) out.push(w);
      }
      return out;
    }

    // --- where pins are written (§4.10.4) ---------------------------------------------------------------------------

    const cutMaps = new WeakMap();
    function cutByKey(plan, key) {
      if (!plan || !Array.isArray(plan.cuts)) return null;
      let map = cutMaps.get(plan);
      if (!map) { map = new Map(plan.cuts.map((c) => [c.key, c])); cutMaps.set(plan, map); }
      return map.get(key) || null;
    }

    // writePath(path, plan) → where a pin for this path is written. A cut whose pins still live under an older key
    // (the plan cut's `pinKey`, after a text edit moved its offset) keeps them there: a pin at the new exact key would
    // win step 1 of the reattachment and leave the older pins, lock pins included, orphaned (§4.10.4).
    function writePath(path, plan) {
      if (typeof path !== 'string' || !path.startsWith('cut/')) return path;
      const at = path.indexOf(':');
      if (at < 0) return path;
      const key = path.slice(4, at);
      const cut = cutByKey(plan, key);
      return cut && cut.pinKey && cut.pinKey !== key ? 'cut/' + cut.pinKey + path.slice(at) : path;
    }

    // writeScope(scope, plan) → the scope the pins of a cut scope live under (writePath for a whole scope).
    function writeScope(scope, plan) {
      return scope.startsWith('cut/') ? writePath(scope + ':x', plan).slice(0, -2) : scope;
    }

    // pinCmd(path, v, plan, pinSig, by = 'user') → the pin.set of a displayed path: written at writePath, with the
    // cut's current text as `sig` on cut paths (§3.9; pinSig is planner.pinSig).
    function pinCmd(path, v, plan, pinSig, by) {
      const cmd = { t: 'pin.set', path: writePath(path, plan), v, by: by || 'user' };
      if (path.startsWith('cut/')) cmd.sig = pinSig(plan, path.slice(4, path.indexOf(':')));
      return cmd;
    }

    // --- pinned parameters of parts that are no longer chosen (§3.4, §6.6 無効) -----------------------------------------

    // The slots of part-parameter pins (kind@key.param) in the given scopes.
    function pinnedParamSlots(pins, scopes) {
      const want = new Set(scopes);
      const out = new Set();
      for (const path of Object.keys(pins || {})) {
        const i = path.indexOf(':');
        const slot = path.slice(i + 1);
        if (want.has(path.slice(0, i)) && slot.includes('@') && slot.includes('.')) out.add(slot);
      }
      return out;
    }

    // pinnedSlots(ctx, pins) → { page, firstCut }: the part-parameter slots pinned at the page scope(s) and at the first
    // cut of the line(s) (what firstCut rows write).
    function pinnedSlots(ctx, pins) {
      const withKeys = (scopes) => scopes.concat(scopes.map((s) => writeScope(s, ctx.plan)));
      const pageScopes = ctx.page === 'lines' ? ctx.lineIds.map((id) => 'line/' + id) : [ctx.scope];
      return { page: pinnedParamSlots(pins, withKeys(pageScopes)),
        firstCut: pinnedParamSlots(pins, withKeys(ctx.lineIds.map((id) => firstCutScope(ctx, id)))) };
    }

    function pinnedParamField(part, slot, where, registry) {
      const idx = part.idx === null ? undefined : part.idx;
      const o = { shared: false, section: where.section, page: where.page, scopes: where.scopes };
      let f = paramFields(part.kind, idx, part.key, registry, o).find((g) => g.path === slot);
      if (!f) {
        // A part the registry does not know (any more): the value is shown as written and can only be unpinned.
        f = { id: (where.page || 'param') + '/' + (where.section || 'param') + '/' + slot, key: slot, path: slot,
          scopes: where.scopes || ALL, section: where.section || null, page: where.page || null, widget: 'text',
          label: PARAM_LABEL, labelText: { ja: part.param, en: part.param }, basic: true, spec: SPEC.text, readOnly: true,
          param: Object.freeze({ kind: part.kind, idx: part.idx, key: part.key, name: part.param, shared: false }), generated: true };
      }
      return Object.freeze(Object.assign({}, f, { basic: true, pinnedOnly: true }, where.flags));
    }

    function partOfSlot(slot) {
      try { return P.parse('work:' + slot).part; } catch (e) { return null; }
    }

    // withPinnedParams(sections, ctx, pinned) → sections plus one row for every pinned part parameter that no row shows
    // (the part changed, or the cuts disagree): after its part's rows, or in a section that lists that kind's params.
    // `pinned` is pinnedSlots(ctx, doc.pins). The inspector reads their state (無効 when the part is not chosen).
    function withPinnedParams(sections, ctx, pinned) {
      // a trim row shows clipOut too (its out handle, ui/media_widgets)
      const shown = new Set(sections.flatMap((s) => s.fields.flatMap((f) => [f.path, f.trimOut]).filter(Boolean)));
      const out = sections.map((s) => Object.assign({}, s, { fields: s.fields.slice() }));
      const matches = (part, kind, idx) => part && part.key !== null && part.param !== null && part.kind === kind && part.idx === idx;
      for (const s of out) {
        for (let i = 0; i < s.fields.length; i++) {
          const f = s.fields[i];
          if (f.widget !== 'part' || !SLOT_KINDS.includes(f.kind)) continue;
          const idx = f.idx === undefined ? null : f.idx;
          const set = f.firstCut ? pinned.firstCut : pinned.page;
          let at = i + 1;
          while (at < s.fields.length && s.fields[at].param && s.fields[at].param.kind === f.kind && s.fields[at].param.idx === idx) at++;
          for (const slot of [...(set || [])].sort()) {
            const part = partOfSlot(slot);
            if (shown.has(slot) || !matches(part, f.kind, idx)) continue;
            const where = { section: s.id, page: ctx.page, scopes: f.scopes, flags: f.firstCut ? { firstCut: true } : {} };
            s.fields.splice(at++, 0, pinnedParamField(part, slot, where, ctx.registry));
            shown.add(slot);
          }
        }
        for (const want of s.params || []) {
          for (const slot of [...(pinned.page || [])].sort()) {
            const part = partOfSlot(slot);
            if (shown.has(slot) || !matches(part, want.kind, null)) continue;
            const where = { section: s.id, page: ctx.page, scopes: ALL, flags: { group: want.kind } };
            s.fields.push(pinnedParamField(part, slot, where, ctx.registry));
            shown.add(slot);
          }
        }
      }
      return out;
    }

    // --- なぜ: explain() in words (§4.16.8, §6.4.4 item 5) -----------------------------------------------------------

    // The string key of a planner rule ('whyRule.<rule>'). The mood slot's own rule (the lyrics and song facts) reads
    // differently from values that follow the mood; element and list slots share one entry per kind of rule.
    function whyRuleKey(rule, slot) {
      const r = String(rule);
      if (r === 'mood' && slot === 'mood') return 'whyRule.moodPick';
      if (r === 'el.text.fill') return 'whyRule.el.textFill';
      const el = /^el\.[a-z]+(?:#\d+)?\.(nudge|fill|hide)$/.exec(r);
      if (el) return 'whyRule.el.' + el[1];
      if (/^(ornament|filter)#\d+$/.test(r)) return 'whyRule.slot';
      return 'whyRule.' + r;
    }

    // A cut as the breadcrumbs name it: 「3行」, or 「3行のカット2」 when the line has several cuts.
    function cutLabel(plan, key, t) {
      if (!cutByKey(plan, key)) return null;
      const list = S.crumbs({ level: 'cut', key }, plan).slice(1).map((c) => t.label(c.label));
      if (!list.length) return null;
      return list.length > 1 ? t('why.lineCut', { line: list[0], cut: list[1] }) : list[0];
    }

    // The part kind a why code's `key` names when it is not the path's own part: the lens or the layout a shot keeps
    // clear of (planner/camera).
    const WHY_KEY_KIND = Object.freeze({ 'cam.lens': 'lens', 'cam.arrange': 'arrange' });

    // whyParts(ex, path, t, plan) → the reasons of an explain() result as display text. Every code or id in the params
    // becomes words (mood and part keys → their labels; tag, scope, by, amount, rule → their strings; a cut key → its
    // line and cut; a song section and a season → their names; a shot or rig preset → its name); the family id is not
    // shown. A reason that would still show a code is left out.
    function whyParts(ex, path, t, plan) {
      if (!ex || !Array.isArray(ex.why)) return [];
      let parsed = null;
      try { parsed = P.parse(path); } catch (e) { parsed = null; }
      const slot = parsed ? parsed.slot : null;
      const part = parsed && parsed.part ? parsed.part : null;
      const partKind = part ? (part.kind === 'atmos' ? 'ornament' : part.kind === 'texture' ? 'filter' : part.kind) : null;
      const word = (prefix, v) => (t.has(prefix + v) ? t(prefix + v) : null);
      const out = [];
      for (const w of ex.why) {
        if (!w || !t.has('why.' + w.code)) continue;
        const p = Object.assign({}, w.params || {});
        let ok = true;
        const put = (k, v) => { if (v === null || v === undefined) ok = false; else p[k] = v; };
        if (p.mood !== undefined) put('mood', t.part('mood', p.mood));
        if (p.tag !== undefined) put('tag', word('tag.', p.tag));
        if (p.scope !== undefined) put('scope', word('scope.', p.scope));
        if (p.by !== undefined) put('by', word('by.', p.by));
        if (p.amount !== undefined) put('amount', word('fld.amount.', p.amount));
        if (p.rule !== undefined) put('rule', word('', whyRuleKey(p.rule, slot)) || t('whyRule.rule'));
        if (p.cut !== undefined) put('cut', cutLabel(plan, p.cut, t));
        // D's camera and line reasons name a song section, a season or another part by its key (DESIGN_2_1 §2.8)
        if (p.section !== undefined) put('section', word('songSec.', p.section));
        if (p.season !== undefined) put('season', word('fld.season.', p.season));
        if (p.key !== undefined) {
          const kind = WHY_KEY_KIND[w.code] || partKind;
          if (kind) p.key = t.part(kind, p.key);
          else if (slot === 'cam.shot') p.key = t.label(SHOT.label(p.key));
          else if (slot === 'rig') p.key = t.label(SHOT.rigLabel(p.key));
        }
        if (typeof p.x === 'number') p.x = p.x.toFixed(2);
        delete p.family;
        if (ok) out.push(t.why(w.code, p));
      }
      return out;
    }

    // --- areas in words (DESIGN_2_1 §3.8 labels) ----------------------------------------------------------------------

    // areaLabel(t, area) → the area's name: 「サビ1」, 「# サビ」, 「3–5行」; a `kind` param reads through songSec.<kind>.
    function areaLabel(t, area) {
      const label = area && area.label;
      if (!Array.isArray(label)) return '';
      const p = Object.assign({}, label[1] || {});
      if (typeof p.kind === 'string' && t.has('songSec.' + p.kind)) p.kind = t('songSec.' + p.kind);
      return t(label[0], p);
    }

    // areaTitle(t, area) → 「サビ1（5行）」 (the several-lines page header, the review title). The whole video, a cut and
    // a single line of a line set (「4行」) name no count.
    function areaTitle(t, area) {
      if (!area) return '';
      const bare = area.kind === 'work' || area.kind === 'cut' || (area.kind === 'lines' && area.n === 1);
      return bare ? areaLabel(t, area) : t('area.title', { area: areaLabel(t, area), n: area.n });
    }

    return {
      WIDGETS, FIELDS, PAGES: PAGE_SECTIONS, FACE_ROLES, FACE_SCRIPTS, LIST_KINDS, SLOT_KINDS, COMMANDS_USED, SNAPS, SEASONS,
      PARAM_LABEL, sectionsFor, contextOf, pageOf, paramFields, widgetFor, optionsFor, slotScopes, fieldPath, decisionsOf, freeIndex,
      agreedKey, sharedNames, pathsFor, clearPathsFor, firstCutScope, pinnedSlots, withPinnedParams, writePath, writeScope,
      pinCmd, whyParts, whyRuleKey, areaLabel, areaTitle,
    };
  });
