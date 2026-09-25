/* 文字PVメーカー v2 — original work. JSDoc type definitions mirroring DESIGN §3 (data model) and §4 (interfaces). */
MV.def('core/types', [], () => {
  'use strict';
  // This module has no runtime content: it only carries the @typedefs below for editors and reviewers.
  // DESIGN.md is the source of truth; when the two disagree, DESIGN.md wins and this file is fixed.

  // ===== §3.1 The saved file ==================================================================================

  /**
   * @typedef {Object} ProjectFile
   * @property {'mojipv.project'} format
   * @property {number} schema                 1 in v2.0
   * @property {Doc} doc                       undoable
   * @property {Side} side                     persisted, not undoable
   */
  /**
   * @typedef {Object} Doc
   * @property {{ app: string, lang: 'auto'|Lang }} meta
   * @property {{ next: number, rows: Row[] }} sheet     next only grows; ids are never reused
   * @property {TimingSettings} timing
   * @property {Song|null} song
   * @property {LookSettings} look
   * @property {Object<string, Pin>} pins                slot path (§3.4) → pin
   * @property {Object<string, number>} salts            'line/r4' | 'cut/r3~0' | 'cut/r3~0:depart' → positive integer
   * @property {Object<string, { n: number }>} locks     lineId → store revision when locked
   * @property {Object<string, KindFilter>} filters      per kind: arrange … theme
   * @property {OutputSettings} output
   */
  /** @typedef {{ id: string, src: string }} Row                      one line of the lyric box, raw text as typed */
  /** @typedef {'ja'|'en'|'zhHant'|'zhHans'|'ko'} Lang */
  /**
   * @typedef {Object} TimingSettings
   * @property {'off'|'beat'|'half'|'bar'} snap
   * @property {number} lead        entrance starts this many seconds before the sung start
   * @property {number} tail        the exit may run this long past the next cut's start
   * @property {number} leadIn      first auto line start when nothing anchors it
   * @property {number} outro       seconds after the last line when there is no song
   * @property {number} tapLatency  subtracted from tap times
   */
  /**
   * @typedef {Object} Song        metadata only; audio bytes live in browser storage keyed by sha1
   * @property {string} name
   * @property {string} sha1
   * @property {number} seconds
   * @property {number|null} bpm
   * @property {number} offset
   * @property {number} meter
   * @property {number} bpmConfidence
   * @property {{ hz: 20, loud: string }} digest   base64 of a Uint8Array loudness envelope (0..255)
   * @property {Object|null} info                  AI song analysis (§4.22)
   */
  /**
   * @typedef {Object} LookSettings
   * @property {number} seed          layout/motion choices
   * @property {number} moodSeed      auto mood and theme
   * @property {'16:9'|'9:16'|'1:1'|'4:5'|'4:3'|'3:4'|'21:9'} aspect
   * @property {'scene'|'chroma'|'black'|'clear'} backdrop
   */
  /** @typedef {{ v: *, by: 'user'|'ai'|'tap'|'lock', sig?: string }} Pin   sig: cut text (marks removed) at pin time; on every cut/… pin */
  /** @typedef {{ only: string[]|null, deny: string[]|null }} KindFilter */
  /**
   * @typedef {Object} OutputSettings
   * @property {'mp4'|'png'|'pngAlpha'} format
   * @property {720|1080|1440|2160} short
   * @property {24|30|60} fps
   * @property {'standard'|'high'|'max'} quality
   * @property {boolean} audio
   * @property {{ t0: number, t1: number }|null} range
   * @property {string|null} name
   */
  /** @typedef {{ looks: { list: LookEntry[], cap: number }, aiLog: AiLogEntry[] }} Side */
  /**
   * @typedef {Object} LookEntry     §3.7
   * @property {number} n
   * @property {number} seed
   * @property {number} moodSeed
   * @property {Object<string, number>} salts     the complete salts map at that moment
   * @property {string} scope
   * @property {LabelRef} label
   * @property {boolean} star
   */
  /** @typedef {[string, Object]} LabelRef          [stringKey, params] for the string table */
  /** @typedef {{ runId: string, tool: string, n: number, applied: Array<{ path?: string, rowId?: string, to: * }> }} AiLogEntry */

  // ===== §3.3–3.5 Ids, scopes, slot paths, pins ===============================================================
  // Row 'r' + base36 · Line rowId or rowId.k · Cut '<lineId>~<offset>' | 'title' | 'intro' | 'outro' | 'gap/<lineId>'
  // Segment 'g<first cut key>'. Scopes: 'work', 'line/<lineId>', 'cut/<cutKey>'; pins cascade cut > line > work.
  // path := scope ':' slot   (grammar in §3.4; implemented by core/paths)

  // ===== §3.9 Commands ========================================================================================
  /**
   * @typedef {{ t: 'lyrics.set', text: string }
   *   | { t: 'lyrics.row', rowId: string, src: string }
   *   | { t: 'lyrics.move', rowIds: string[], beforeRowId: string|null }
   *   | { t: 'meta.set', title?: string|null, artist?: string|null }
   *   | { t: 'pin.set', path: string, v: *, by: Pin['by'], sig?: string }
   *   | { t: 'pin.clear', path: string }
   *   | { t: 'pin.clearUnder', scope: string, by?: Pin['by'] }
   *   | { t: 'pin.promote', path: string, to: 'line'|'work' }
   *   | { t: 'pin.copy', from: string, to: string[], sigs: Object<string, string> }
   *   | { t: 'salt.bump', key: string }
   *   | { t: 'look.omakase', seed: number, moodSeed: number }
   *   | { t: 'look.seed', seed: number }
   *   | { t: 'look.restore', seed: number, moodSeed: number, salts: Object<string, number> }
   *   | { t: 'look.set', key: 'aspect'|'backdrop', v: string }
   *   | { t: 'lock.set', lineId: string, pins: Object<string, Pin> }
   *   | { t: 'lock.clear', lineId: string }
   *   | { t: 'filter.set', kind: string, only: string[]|null, deny: string[]|null }
   *   | { t: 'time.shift', lineIds: string[], delta: number, base: Object<string, { start: number, end: number }> }
   *   | { t: 'time.tap', marks: Array<{ lineId: string, start?: number, end?: number }> }
   *   | { t: 'timing.set', key: string, v: * }
   *   | { t: 'song.set', song: Song } | { t: 'song.clear' } | { t: 'song.info', info: Object }
   *   | { t: 'output.set', key: string, v: * }
   *   | { t: 'batch', cmds: Command[] }} Command
   */

  // ===== §3.10 History ========================================================================================
  /**
   * @typedef {Object} HistoryEntry
   * @property {Doc} before
   * @property {Doc} after
   * @property {LabelRef} label
   * @property {*} where
   * @property {string|null} mergeKey
   * @property {*} selBefore
   * @property {*} selAfter
   * @property {number} n
   */

  // ===== §3.11 Parsed lyrics (not saved) ======================================================================
  /** @typedef {{ meta: { title: string|null, artist: string|null }, rows: ParsedRow[] }} Sheet */
  /**
   * @typedef {Object} ParsedRow
   * @property {string} id
   * @property {'lyric'|'blank'|'comment'|'meta'} kind
   * @property {number[]} stamps           LRC start times, in written order
   * @property {string} text               plain text: marks and stamps removed, escapes resolved
   * @property {Array<[number, number]>|null} pieces   from '/', offsets into text
   * @property {Array<[number, number]>} emph          from '*…*'
   * @property {boolean} impact            trailing '!'
   * @property {string|null} note          text after '|'
   * @property {string|null} heading       for comments: the text after '#'
   * @property {Lang} script               dominant script of text
   */
  /**
   * @typedef {Object} Line                one per sung occurrence, in time order (§4.9.3)
   * @property {string} id                 'r7' or 'r7.1'
   * @property {string} row
   * @property {number} occ
   * @property {number} index              position in the line list
   * @property {string} text
   * @property {Array<[number, number]>|null} pieces
   * @property {Array<[number, number]>} emph
   * @property {boolean} impact
   * @property {string|null} note
   * @property {Lang} lang
   * @property {number|null} stamp         the stamp of this occurrence
   * @property {number} pauseBefore        blank rows directly above the row (first occurrence only)
   * @property {string|null} heading       nearest '#' comment above, within 3 rows
   */

  // ===== §3.12 The Plan (not saved) ===========================================================================
  /**
   * @typedef {Object} Plan
   * @property {1} v
   * @property {string} hash               hashJSON of the Plan without `hash`
   * @property {number} duration
   * @property {{ aspect: string, w: number, h: number, short: number }} design
   * @property {PlanLook} look
   * @property {{ bpm: number, offset: number, meter: number }|null} beats
   * @property {PlanLine[]} lines
   * @property {CutPlan[]} cuts            time order, special cuts included
   * @property {GroundSegment[]} grounds
   * @property {SeamPlan[]} seams
   * @property {Impulse[]} impulses
   * @property {Warning[]} warnings
   * (plan.env: non-enumerable 20 Hz loudness envelope, not hashed)
   */
  /**
   * @typedef {Object} PlanLook
   * @property {Decision} mood
   * @property {Decision} theme
   * @property {Decision} season
   * @property {Object<string, number>} amounts
   * @property {Object<string, string>} amountsFrom
   * @property {Object<string, string>} palette             the 7 color tokens → '#RRGGBB'
   * @property {Object<string, Object<string, { family: string, weight: number }>>} faces
   * @property {Decision} texture
   * @property {LookSettings['backdrop']} backdrop
   */
  /**
   * @typedef {Object} PlanLine
   * @property {string} id
   * @property {string} row
   * @property {number} index
   * @property {string} text
   * @property {number} t0
   * @property {number} t1
   * @property {{ start: 'pin'|'lrc'|'auto', end: 'pin'|'auto' }} by
   * @property {string[]} cuts
   * @property {boolean} locked
   * @property {Lang} lang
   */
  /**
   * @typedef {Object} CutPlan
   * @property {string} key
   * @property {string|null} line
   * @property {'lyric'|'focus'|'title'|'interlude'|'outro'} role
   * @property {string} text
   * @property {Array<[number, number]>} emph
   * @property {boolean} impact
   * @property {string|null} note
   * @property {number} t0
   * @property {number} t1
   * @property {number} a                  visible from (t0 − timing.lead)
   * @property {number} b                  visible until (next cut's t0 + timing.tail)
   * @property {number} repT               hero time (core/motion.heroTime)
   * @property {Lang} lang
   * @property {CutFeatures} feat
   * @property {string} fp                 fingerprint of everything the scene build needs
   * @property {Object<string, Decision>} slots
   * @property {Object<string, Object>} els                element pins: owner → { nudge?, fill?, hide? }
   * @property {number} ground             index into plan.grounds
   * @property {number} seamIn             index into plan.seams, or −1
   */
  /**
   * @typedef {Object} GroundSegment
   * @property {string} key                'g<first cut key>'
   * @property {number} t0
   * @property {number} t1
   * @property {string[]} cuts
   * @property {Decision} ground
   * @property {Decision} atmos
   * @property {string} fp
   */
  /**
   * @typedef {Object} SeamPlan
   * @property {string} into               receiving cut key
   * @property {number} at
   * @property {number} dur
   * @property {'text'|'world'} scope
   * @property {string} a
   * @property {string} b
   * @property {Decision} slot
   */
  /** @typedef {{ t: number, kind: 'flash'|'shake'|'slip'|'punch', amp: number, decay: number }} Impulse */

  // ===== §3.13 Decision, FieldState, Warning ==================================================================
  /**
   * @typedef {Object} Decision
   * @property {*} v
   * @property {Object<string, *>} [p]
   * @property {'auto'|'pin:cut'|'pin:line'|'pin:work'|'mark'|'rule'|'fallback'} from
   * @property {Pin['by']} [by]            present when from starts with 'pin'
   * @property {Object<string, string>} [pfrom]   per-parameter source when it differs from 'auto'
   */
  /**
   * @typedef {Object} FieldState
   * @property {string} path
   * @property {*} value
   * @property {LabelRef|string} display
   * @property {'auto'|'pinned'|'inherited'|'ai'|'locked'|'mark'|'derived'|'inactive'|'mixed'} state
   * @property {null|'cut'|'line'|'work'} pinnedAt
   * @property {null|Pin['by']} by
   * @property {ParamSpec|Object} schema
   * @property {LabelRef|null} autoText
   * @property {Array<'cut'|'line'|'work'>} canPinAt
   * @property {null|'part-changed'|'not-applicable'} inactiveReason
   * @property {null|{ code: string, params: Object }} warn
   */
  /**
   * @typedef {Object} Warning
   * @property {'pin-bad-value'|'pin-not-applicable'|'pin-filtered'|'pin-off-season'|'orphan-pin'|'shadowed-pin'|
   *   'lock-partial'|'pool-empty'|'time-order'|'time-compressed'|'title-skipped'|'overfull'|'font-fallback'|
   *   'piece-merged'} code
   * @property {string} [path]
   * @property {string} [line]
   * @property {string} [cut]
   * @property {*} [detail]
   */

  // ===== §4.1 Kernel ==========================================================================================
  /**
   * @typedef {Object} Stream           core/rng; every method advances the stream deterministically
   * @property {number} seed
   * @property {() => number} next                                 [0, 1)
   * @property {(lo: number, hi: number) => number} range           [lo, hi)
   * @property {(lo: number, hi: number) => number} int             integer in [lo, hi], inclusive
   * @property {(p: number) => boolean} chance
   * @property {<T>(array: T[]) => T} pick
   * @property {<T>(values: T[], weights: number[]) => T} weighted
   * @property {<T>(array: T[]) => T[]} shuffle                     new array (Fisher–Yates)
   * @property {(n: number) => Float32Array} floats
   * @property {(...labels: *) => Stream} fork                      = stream(this.seed, ...labels); does not advance
   */
  /** @typedef {Float32Array} Mat2D     [a, b, c, d, e, f] like Canvas setTransform */

  // ===== §4.2 Parameter specs =================================================================================
  /**
   * @typedef {Object} ParamSpec
   * @property {'num'|'int'|'bool'|'enum'|'ease'|'order'|'ink'|'color'|'face'|'text'} type
   * @property {number} [min]
   * @property {number} [max]              num/int; text: max length (default 40)
   * @property {number} [step]
   * @property {Array<string|number>} [of]  enum values
   * @property {''|'s'|'du'|'em'|'deg'|'frac'|'x'|'Hz'} [unit]
   * @property {{ ja: string, en: string }} [label]   required for part params
   * @property {AutoSpec} auto             required
   * @property {'basic'|'advanced'} [ui]   default 'basic'
   * @property {boolean} [ai]              expose to the AI catalog (default true)
   */
  /**
   * @typedef {{ value: * }
   *   | { pick: Array<*>, weights?: number[] }
   *   | { range: [number, number] }
   *   | { range: [number, number], follow: string, jitter?: number }
   *   | { fn: (f: CutFeatures, rng: Stream, look: Object) => *, why: { ja: string, en: string } }} AutoSpec
   * follow SOURCE: energy density cells dur tempo position emph impact amount.<key> mood.<tag>; '-' prefix inverts
   */
  /** @typedef {{ f: CutFeatures, look: { amounts: Object<string, number>, mood: Object, bpm: number|null }, rng: Stream }} AutoContext */

  // ===== §4.3 Paths and pins ==================================================================================
  /**
   * @typedef {Object} ParsedPath
   * @property {{ kind: 'work'|'line'|'cut', id: string|null, lineId: string|null }} scope
   * @property {string} slot                                       the text after ':'
   * @property {{ kind: string, idx: number|null, key: string|null, param: string|null }|null} part
   * @property {{ owner: string, field: 'nudge'|'fill'|'hide' }|null} el
   * @property {string|null} name
   */
  /**
   * @typedef {Object} PinIndex
   * @property {Map<string, Pin>} work
   * @property {Map<string, Map<string, Pin>>} line                lineId → slot → pin
   * @property {Map<string, Map<string, Pin>>} cut                 pinCutKey → slot → pin
   * @property {Map<string, string[]>} byLine                      lineId → its pin cut keys, by offset (added field)
   * @property {string[]} bad                                      paths that do not parse (added field)
   */
  /** @typedef {{ cutKey: string|null, pinCutKey?: string|null, lineId?: string|null }} PinAt */
  /** @typedef {{ v: *, from: 'pin:cut'|'pin:line'|'pin:work', by: Pin['by'], at: string }} PinHit   at = path of the winning pin */
  /** @typedef {{ map: Object<string, string>, orphans: string[], shadowed: string[] }} AttachResult */

  // ===== §4.4–4.6 Doc, store, registry ========================================================================
  /**
   * @typedef {Object} Touched
   * @property {Set<string>|'all'} rows
   * @property {Set<string>} pins
   * @property {boolean} look
   * @property {boolean} timing
   * @property {boolean} song
   * @property {boolean} output
   * @property {boolean} filters
   * @property {boolean} salts
   * @property {boolean} locks
   */
  /** @typedef {{ label?: LabelRef, mergeKey?: string, where?: *, sel?: { before: *, after: * } }} StoreMeta */
  /**
   * @typedef {Object} Store
   * @property {Doc} doc
   * @property {Side} side
   * @property {number} rev
   * @property {(cmd: Command, meta?: StoreMeta) => number} dispatch
   * @property {(meta: StoreMeta, cmds: Command[]) => number} batch
   * @property {(mergeKey: string) => { end: () => void }} gesture
   * @property {() => void} seal
   * @property {() => ({ where: *, sel: * }|null)} undo
   * @property {() => ({ where: *, sel: * }|null)} redo
   * @property {() => { undo: LabelRef|null, redo: LabelRef|null }} peek
   * @property {() => Array<{ n: number, label: LabelRef }>} list
   * @property {(n: number) => void} jump
   * @property {(fn: (side: Side) => Side) => void} setSide
   * @property {(doc: Doc, side: Side) => void} load
   * @property {(event: 'doc'|'side', fn: Function) => (() => void)} on
   */
  /**
   * @typedef {Object} PartDef         §4.18.1
   * @property {string} kind
   * @property {string} key
   * @property {{ ja: string, en: string }} label
   * @property {{ ja: string, en: string }} [blurb]
   * @property {string[]} [tags]
   * @property {string} [family]
   * @property {null|'spring'|'summer'|'autumn'|'winter'} [season]
   * @property {number} [weight]
   * @property {{ orient?: string[], cells?: number[], energy?: number[], scripts?: string[], aspects?: string[],
   *   roles?: string[], impact?: boolean }} [traits]
   * @property {(f: CutFeatures, chosen: Object) => number} [fits]
   * @property {string} [gate]
   * @property {boolean} [pool]
   * @property {boolean} [fallback]
   * @property {string[]} [needs]
   * @property {Object<string, Object>} [shared]
   * @property {Object<string, ParamSpec>} [params]
   */
  /**
   * @typedef {Object} Registry
   * @property {string} version
   * @property {(kind: string, key: string) => PartDef|null} get
   * @property {(kind: string, key: string) => boolean} has
   * @property {(kind: string) => string[]} keys
   * @property {(kind?: string) => PartDef[]} all
   * @property {(kind: string, q: { role?: string, season?: string, filters?: Object, orient?: string, script?: string,
   *   scope?: 'cut'|'run' }) => string[]} pool
   * @property {(kind: string) => string} fallback
   * @property {(kind: string, key: string, lang: string) => string} label
   */

  // ===== §4.7 Motion ==========================================================================================
  /** @typedef {{ dur: number, each: number, count: number, window: number, share: number }} FitMotionInput */
  /** @typedef {{ dur: number, each: number, total: number }} FitMotionResult */

  // ===== §4.11 Timing, beats, tap =============================================================================
  /** @typedef {{ times: Array<{ id: string, t0: number, t1: number, by: PlanLine['by'] }>, duration: number, warnings: Warning[] }} SolvedTimes */
  /**
   * @typedef {Object} Grid
   * @property {number} period
   * @property {(t: number) => { index: number, phase: number, since: number }} beatAt
   * @property {(t: number) => { index: number, phase: number }} barAt
   * @property {(t: number, unit: 'beat'|'half'|'bar', tol: number) => number} snap
   * @property {(t0: number, t1: number) => Float64Array} beatsIn
   */
  /** @typedef {{ type: 'mark'|'end'|'back'|'pause'|'resume', t: number }} TapEvent */

  // ===== §4.13 Audio ==========================================================================================
  /**
   * @typedef {Object} SongAnalysis
   * @property {number} duration
   * @property {{ hz: 100, loud: Float32Array }} env
   * @property {{ hz: 100, strength: Float32Array }} onset
   * @property {number} bpm
   * @property {number} bpmConfidence
   * @property {number} offset
   * @property {4} meter
   */
  /**
   * @typedef {Object} Player
   * @property {(from?: number) => void} play
   * @property {() => void} pause
   * @property {(t: number) => void} seek
   * @property {() => number} now
   * @property {boolean} playing
   * @property {number} rate
   * @property {boolean} muted
   * @property {(b: boolean) => void} setMuted
   * @property {(eventTimeStamp: number) => number} outputTimeOf
   * @property {(event: 'state'|'ended', fn: Function) => void} on
   */

  // ===== §4.14–4.15 Fonts and text ============================================================================
  /** @typedef {{ family: string, weight: number, script: string, css: (sizePx: number) => string, key: string }} FontRef */
  /**
   * @typedef {Object} FontBook
   * @property {(refs: FontRef[], textByFamily: Object<string, string>) => void} request
   * @property {(refs: FontRef[], text: string, opts?: { timeoutMs?: number }) => Promise<{ loaded: FontRef[], failed: FontRef[] }>} ready
   * @property {number} epoch
   * @property {(ref: FontRef) => 'idle'|'loading'|'ready'|'failed'} status
   * @property {(event: 'epoch', fn: Function) => (() => void)} on
   */
  /** @typedef {{ key: string, width: (css: string, str: string) => number, metrics: (css: string) => { ascent: number, descent: number } }} Measurer */
  /** @typedef {{ x: number, y: number, w: number, h: number }} Box */
  /**
   * @typedef {Object} RunSpec
   * @property {[number, number]} span
   * @property {string} [text]
   * @property {'h'|'v'} orient
   * @property {'display'|'serif'|'body'} face
   * @property {number} size
   * @property {number} [tracking]
   * @property {number} [leading]
   * @property {Box} box
   * @property {'start'|'center'|'end'} [align]
   * @property {'start'|'center'|'end'} [valign]
   * @property {'shrink'|'none'} [fit]
   * @property {number} [maxLines]
   * @property {'phrase'|'char'|'none'} [breakAt]
   * @property {Array<[number, number]>} [emph]
   * @property {number} [emphScale]
   * @property {string} [ink]
   * @property {string} [emphInk]
   * @property {string} [style]
   * @property {'wipeX'|'wipeY'|'diag'|'iris'|'lines'} [revealMode]
   * @property {string} [sizeGroup]
   * @property {number} [rot]
   * @property {{ vx: number, vy: number }} [move]
   */
  /**
   * @typedef {Object} RunLayout
   * @property {number} size
   * @property {Box} box
   * @property {number} n
   * @property {string[]} ch
   * @property {Uint8Array} cls
   * @property {Float32Array} x
   * @property {Float32Array} y
   * @property {Float32Array} w
   * @property {Float32Array} h
   * @property {Uint8Array} rot
   * @property {Int16Array} line
   * @property {Int16Array} word
   * @property {Uint8Array} emph
   * @property {Array<{ from: number, to: number, x: number, y: number, w: number, h: number }>} lines
   * @property {Array<{ from: number, to: number, cx: number, cy: number }>} words
   * @property {boolean} overfull
   */

  // ===== §4.16 Planner ========================================================================================
  /**
   * @typedef {Object} CutFeatures
   * @property {number} cells
   * @property {number} graphemes
   * @property {Lang} script
   * @property {number} latin
   * @property {Array<'h'|'v'>} orients
   * @property {number} words
   * @property {{ glyph: number, word: number, line: number }} units
   * @property {boolean} emph
   * @property {boolean} impact
   * @property {number} dur
   * @property {number} cps
   * @property {number} energy
   * @property {number} beat
   * @property {boolean} [onBeat]
   * @property {string|null} section
   * @property {string|null} repeatOf
   * @property {number} pos
   * @property {string} role
   */
  /**
   * @typedef {Object} Explanation
   * @property {string} path
   * @property {*} value
   * @property {string} from
   * @property {string} [by]
   * @property {Array<{ code: string, params: Object }>} why
   * @property {Array<{ key: string, w: number, masked: null|'filter'|'season'|'trait'|'gate'|'role' }>} alts
   */

  // ===== §4.17–4.19 Scene, kit, frame =========================================================================
  /**
   * @typedef {Object} Behaviour
   * @property {number} phase            PH.REST … PH.STYLE
   * @property {'until'|'after'|'during'|'always'} live
   * @property {number} from
   * @property {number} to
   * @property {number} t0
   * @property {number} t1
   * @property {(P: Object, t: number, b: Behaviour) => void} run   defined once at module level; pure in t
   */
  /**
   * @typedef {Object} LayerSpec
   * @property {string} name
   * @property {number} parallax
   * @property {'source-over'|'multiply'|'screen'|'overlay'|'lighter'|'difference'} [blend]
   * @property {number} [opacity]
   * @property {boolean} [isolate]
   * @property {null|{ blur: number }} [filter]
   * @property {null|{ layer: string, invert: boolean }} [mask]
   * @property {'none'|'static'} [cache]
   */
  /**
   * @typedef {Object} Scene
   * @property {string} key
   * @property {string} fp
   * @property {Object} table
   * @property {Behaviour[]} behaviours
   * @property {LayerSpec[]} layers
   * @property {number} cam
   * @property {Array<{ el: string, slot: string }>} owners
   * @property {{ from: number, to: number }} text
   * @property {Array<Object>} runs
   * @property {{ a: number, b: number }} span
   * @property {Warning[]} warnings
   * @property {string[]} glyphKeys
   * @property {boolean} provisional
   */
  /**
   * @typedef {Object} CutTarget
   * @property {number} from
   * @property {number} to
   * @property {Array<Object>} runs
   * @property {{ glyph: number, word: number, line: number, run: number }} units
   * @property {{ word: Int16Array, line: Int16Array, run: Int16Array }} unitOf
   * @property {Uint8Array} emph
   * @property {Box} focus
   */
  /**
   * @typedef {Object} PartEnv
   * @property {{ w: number, h: number, cx: number, cy: number, short: 1080, safe: { l: number, t: number, r: number, b: number } }} D
   * @property {CutPlan} cut
   * @property {CutFeatures} feat
   * @property {string} role
   * @property {{ a: number, rest: number, out: number, b: number }} times
   * @property {{ face: string, scale: number, ink: string, style: string }} textStyle
   * @property {Object} sb                SceneBuilder (§4.17.3)
   * @property {Object} text              TextService
   * @property {Object<string, string>} pal
   * @property {Object} faces
   * @property {Object<string, number>} amounts
   * @property {Grid|null} grid
   * @property {(tl: number) => number} level
   * @property {Stream} rng
   * @property {string} owner
   * @property {{ focus: Box, free: Box[] }|null} hints
   * @property {(tl: number) => number} envelope
   */
  /**
   * @typedef {Object} FrameGraph
   * @property {number} t
   * @property {Array<{ i: number, tl: number }>} cuts
   * @property {Array<{ i: number, tl: number }>} grounds
   * @property {null|{ i: number, u: number, scope: string, aCuts: number[], bCuts: number[], aGround: number, bGround: number }} seam
   * @property {{ texture: Decision|null, accents: Array<{ cut: number, slot: string, tl: number }> }} post
   * @property {LookSettings['backdrop']} backdrop
   */
  /** @typedef {{ canvas: Object, ctx: Object, w: number, h: number }} Surface */
  /** @typedef {{ create: (w: number, h: number, opts: { alpha: boolean }) => { canvas: Object, ctx: Object } }} CanvasFactory */

  // ===== §4.20–4.21 Engine and export =========================================================================
  /**
   * @typedef {Object} Engine
   * @property {(doc: Doc) => { plan: Plan, changedCuts: string[], changedGrounds: string[] }} setDoc
   * @property {Plan} plan
   * @property {(t0: number, t1: number, opts?: { export?: boolean }) => Promise<void>} prepare
   * @property {(surface: Surface, t: number, opts: Object) => FrameStats} renderFrame
   * @property {(x: number, y: number) => Array<{ cut: string, line: string|null, owner: string, slot?: string, node: number }>} hitTest
   * @property {() => Array<{ cut: string, line: string|null, owner: string, quad: Float32Array }>} boxes
   * @property {(ref: { kind: string, key: string, params?: Object }, surface: Surface, opts: Object) => void} thumb
   * @property {() => Warning[]} warnings
   * @property {() => Engine} fork
   * @property {() => Object} stats
   * @property {() => void} dispose
   */
  /** @typedef {{ ms: number, drawn: { glyphs: number, shapes: number, paints: number, particles: number }, passes: number, provisional: boolean }} FrameStats */
  /** @typedef {{ bytes: number, frames: number, ms: number, name: string, blob?: Blob }} ExportResult */

  // ===== §4.22–4.24 AI, UI, i18n ==============================================================================
  /**
   * @typedef {Object} Change
   * @property {string} id
   * @property {string} kind      theme mood season amount flash palette avoid allow part impact emphasis cut note remove time rows songInfo
   * @property {'work'|'line'|'rows'} scope
   * @property {string} [lineId]
   * @property {string} [rowId]
   * @property {string} [path]
   * @property {*} from
   * @property {*} to
   * @property {{ rev: number, value?: *, src?: string }} base
   * @property {LabelRef} label
   * @property {boolean} checked
   * @property {boolean} stale
   */
  /**
   * @typedef {{ level: 'work' }
   *   | { level: 'line', ids: string[] }
   *   | { level: 'cut', key: string }
   *   | { level: 'el', scope: string, el: 'text'|'ornament'|'ground'|'lens'|'filter'|'seam', idx?: number }} Sel
   */
  /**
   * @typedef {Object} FieldSpec
   * @property {string} id
   * @property {string} path
   * @property {Array<'work'|'line'|'cut'>} scopes
   * @property {string} [el]
   * @property {string} section
   * @property {'part'|'choice'|'number'|'time'|'color'|'font'|'toggle'|'words'|'cutpoints'|'text'|'slots'} widget
   * @property {string} label
   * @property {string} [hint]
   * @property {boolean} basic
   * @property {(ctx: Object) => boolean} [when]
   */
  /** @typedef {(key: string, params?: Object) => string} Translate   i18n/t.createT(lang, strings, registry?) */

  return {};
});
