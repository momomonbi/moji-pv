/* 文字PVメーカー v2 — original work. Command reducers: the only way the document changes (DESIGN §3.6, §3.9, §4.12). */
MV.def('core/commands', ['core/doc', 'core/paths', 'core/pins', 'core/lyrics', 'core/reconcile', 'core/num'],
  (D, P, PINS, L, R, N) => {
    'use strict';

    class CommandError extends Error {
      constructor(code, message) { super(message || code); this.name = 'CommandError'; this.code = code; }
    }

    function need(ok, message) { if (!ok) throw new CommandError('payload', message); }

    // ---- small immutable helpers ---------------------------------------------------------------------------------

    function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
    function isUint32(v) { return Number.isInteger(v) && v >= 0 && v <= 0xffffffff; }
    function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }

    // doc with doc[key] = value; the same doc when the value is already there.
    function put(obj, key, value) {
      if (obj[key] === value) return obj;
      return Object.assign({}, obj, { [key]: value });
    }

    function without(obj, keys) {
      let out = obj;
      for (const k of keys) {
        if (!(k in out)) continue;
        if (out === obj) out = Object.assign({}, obj);
        delete out[k];
      }
      return out;
    }

    // Structural equality of JSON values.
    function sameJSON(a, b) {
      if (a === b) return true;
      if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
      if (Array.isArray(a) !== Array.isArray(b)) return false;
      const ka = Object.keys(a), kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !sameJSON(a[k], b[k])) return false;
      return true;
    }

    // A private copy of a JSON value from a payload (the store freezes documents; the caller keeps its object).
    function copyJSON(v, what) {
      if (v === null || typeof v !== 'object') {
        const t = typeof v;
        need(v === null || t === 'string' || t === 'boolean' || (t === 'number' && Number.isFinite(v)), what + ' must be JSON');
        return v;
      }
      let text;
      try { text = JSON.stringify(v); } catch (e) { text = undefined; }
      need(typeof text === 'string', what + ' must be JSON');
      return JSON.parse(text);
    }

    function parsePath(path) {
      need(typeof path === 'string', 'path must be a string');
      try {
        return P.parse(path);
      } catch (e) {
        throw new CommandError('payload', 'bad path ' + path + ' (' + e.code + ')');
      }
    }

    function checkScope(scope) {
      need(typeof scope === 'string', 'scope must be a string');
      let ok = false;
      try { ok = scope.indexOf(':') < 0 && P.scopeKey(scope) === scope; } catch (e) { ok = false; }
      need(ok, 'bad scope ' + scope);
      return scope;
    }

    function checkBy(by) {
      need(D.PIN_BY.includes(by), 'by must be one of ' + D.PIN_BY.join(' '));
      return by;
    }

    // Problems that `validate` reports for one part of a candidate document.
    function problemsIn(doc, prefix) {
      return D.validate(doc).filter((p) => p.startsWith(prefix));
    }

    // ---- lyrics -----------------------------------------------------------------------------------------------------

    function lyricsSet(doc, cmd) {
      need(typeof cmd.text === 'string', 'text must be a string');
      const rows = doc.sheet.rows;
      if (rows.map((r) => r.src).join('\n') === cmd.text) return doc;
      const res = R.reconcile(rows, cmd.text, doc.sheet.next);
      return withRows(doc, res.rows, res.next, res.info.before, res.info.after, res.edited);
    }

    // New rows plus §4.10.3 on pins, salts and locks.
    function withRows(doc, rows, next, before, after, edited) {
      const old = doc.sheet.rows;
      if (next === doc.sheet.next && rows.length === old.length && rows.every((r, i) => r === old[i])) return doc;
      const keyed = R.remapKeyed({ pins: doc.pins, salts: doc.salts, locks: doc.locks }, before, after, edited);
      let out = put(doc, 'sheet', Object.assign({}, doc.sheet, { next, rows }));
      out = put(out, 'pins', keyed.pins);
      out = put(out, 'salts', keyed.salts);
      return put(out, 'locks', keyed.locks);
    }

    function rowIndex(doc, rowId) {
      need(typeof rowId === 'string', 'rowId must be a string');
      const i = doc.sheet.rows.findIndex((r) => r.id === rowId);
      need(i >= 0, 'unknown row ' + rowId);
      return i;
    }

    function lyricsRow(doc, cmd) {
      const i = rowIndex(doc, cmd.rowId);
      need(typeof cmd.src === 'string' && !/[\r\n]/.test(cmd.src), 'src must be one line of text');
      const old = doc.sheet.rows[i];
      if (old.src === cmd.src) return doc;
      const row = { id: old.id, src: cmd.src };
      const before = R.rowInfo([old]), after = R.rowInfo([row]);
      const edited = new Set(before.get(old.id).text === after.get(old.id).text ? [] : [old.id]);
      const rows = doc.sheet.rows.slice();
      rows[i] = row;
      return withRows(doc, rows, doc.sheet.next, before, after, edited);
    }

    function lyricsMove(doc, cmd) {
      need(Array.isArray(cmd.rowIds) && cmd.rowIds.length > 0, 'rowIds must be a non-empty list');
      const moving = new Set(cmd.rowIds);
      need(moving.size === cmd.rowIds.length, 'rowIds must be unique');
      cmd.rowIds.forEach((id) => rowIndex(doc, id));
      const target = cmd.beforeRowId === undefined ? null : cmd.beforeRowId;
      if (target !== null) {
        rowIndex(doc, target);
        need(!moving.has(target), 'beforeRowId cannot be one of the moved rows');
      }
      const rows = doc.sheet.rows;
      const rest = rows.filter((r) => !moving.has(r.id));
      const block = rows.filter((r) => moving.has(r.id));
      const at = target === null ? rest.length : rest.findIndex((r) => r.id === target);
      const out = rest.slice(0, at).concat(block, rest.slice(at));
      if (out.every((r, i) => r === rows[i])) return doc;
      return put(doc, 'sheet', Object.assign({}, doc.sheet, { rows: out }));
    }

    // Rewrites, inserts (at the top) or removes the [ti:] / [ar:] rows. null or '' removes.
    function metaSet(doc, cmd) {
      let rows = doc.sheet.rows;
      let next = doc.sheet.next;
      for (const [field, tag] of [['title', 'ti'], ['artist', 'ar']]) {
        if (cmd[field] === undefined) continue;
        need(cmd[field] === null || typeof cmd[field] === 'string', field + ' must be a string or null');
        const value = cmd[field] === null ? '' : cmd[field].replace(/[\r\n]+/g, ' ').trim();
        const found = rows.map((r, i) => (metaTag(r.src) === tag ? i : -1)).filter((i) => i >= 0);
        if (value === '') {
          if (found.length) rows = rows.filter((r, i) => !found.includes(i));
          continue;
        }
        const src = '[' + tag + ':' + value + ']';
        if (found.length) {
          if (rows[found[0]].src !== src) {
            rows = rows.slice();
            rows[found[0]] = { id: rows[found[0]].id, src };
          }
          continue;
        }
        const titleAt = tag === 'ar' ? rows.findIndex((r) => metaTag(r.src) === 'ti') : -1;
        rows = rows.slice();
        rows.splice(titleAt + 1, 0, { id: 'r' + (next++).toString(36), src });
      }
      if (rows === doc.sheet.rows) return doc;
      return put(doc, 'sheet', Object.assign({}, doc.sheet, { next, rows }));
    }

    function metaTag(src) {
      const row = L.parseRow(src);
      return row.kind === 'meta' ? row.tag : null;
    }

    // ---- pins -------------------------------------------------------------------------------------------------------

    // §3.6: a new line-scope user pin on a locked line removes the lock pins of that slot in the line's cuts.
    function releaseLockedSlot(doc, pins, parsed, by) {
      if (parsed.scope.kind !== 'line' || by !== 'user' || !doc.locks[parsed.scope.id]) return pins;
      const lineId = parsed.scope.id;
      const drop = Object.keys(pins).filter((path) => {
        if (!path.startsWith('cut/') || pins[path].by !== 'lock') return false;
        const at = safeParse(path);
        return at !== null && at.scope.lineId === lineId && at.slot === parsed.slot;
      });
      return without(pins, drop);
    }

    function safeParse(path) {
      try { return P.parse(path); } catch (e) { return null; }
    }

    function makePin(parsed, v, by, sig) {
      if (parsed.scope.kind !== 'cut') return { v, by };
      need(typeof sig === 'string', 'sig is required on cut pins');
      return { v, by, sig };
    }

    function setPin(pins, path, pin) {
      const old = pins[path];
      return old && sameJSON(old, pin) ? pins : Object.assign({}, pins, { [path]: pin });
    }

    function pinSet(doc, cmd) {
      const parsed = parsePath(cmd.path);
      const by = checkBy(cmd.by);
      const pin = makePin(parsed, copyJSON(cmd.v, 'v'), by, cmd.sig);
      const pins = releaseLockedSlot(doc, setPin(doc.pins, cmd.path, pin), parsed, by);
      return put(doc, 'pins', pins);
    }

    function pinClear(doc, cmd) {
      need(typeof cmd.path === 'string', 'path must be a string');
      return put(doc, 'pins', without(doc.pins, [cmd.path]));
    }

    function pinClearUnder(doc, cmd) {
      const scope = checkScope(cmd.scope);
      if (cmd.by !== undefined) checkBy(cmd.by);
      const drop = PINS.pinsUnder(doc.pins, scope)
        .filter((path) => doc.pins[path].by !== 'lock' && (cmd.by === undefined || doc.pins[path].by === cmd.by));
      return put(doc, 'pins', without(doc.pins, drop));
    }

    // Slots that make sense only at one scope (§3.4.1–3.4.3), so they are never promoted or copied.
    const LINE_ONLY = new Set(['start', 'end', 'split', 'lang']);
    const CUT_ONLY = new Set(['t0']);
    const TEXT_SLOTS = new Set(['orient', 'text.face', 'text.scale', 'text.ink', 'text.style']);

    function pinPromote(doc, cmd) {
      const parsed = parsePath(cmd.path);
      need(cmd.to === 'line' || cmd.to === 'work', "to must be 'line' or 'work'");
      const from = parsed.scope.kind;
      need(from === 'cut' || (from === 'line' && cmd.to === 'work'), 'a pin moves only to a broader scope');
      need(cmd.to !== 'line' || parsed.scope.lineId !== null, 'special cuts have no line');
      need(!CUT_ONLY.has(parsed.slot) && !(cmd.to === 'work' && LINE_ONLY.has(parsed.slot)),
        parsed.slot + ' cannot be pinned at ' + cmd.to + ' scope');
      const pin = doc.pins[cmd.path];
      if (!pin) return doc;
      const target = (cmd.to === 'line' ? 'line/' + parsed.scope.lineId : 'work') + ':' + parsed.slot;
      const moved = { v: pin.v, by: pin.by === 'lock' ? 'user' : pin.by };
      return put(doc, 'pins', setPin(without(doc.pins, [cmd.path]), target, moved));
    }

    // Slot pins that "paste look" copies: part choices and their params, orient and text.* (not timing, not el.*).
    function copyable(parsed) {
      return parsed.part !== null || TEXT_SLOTS.has(parsed.slot);
    }

    function pinCopy(doc, cmd) {
      const from = checkScope(cmd.from);
      need(Array.isArray(cmd.to), 'to must be a list of scopes');
      const sigs = cmd.sigs === undefined ? {} : cmd.sigs;
      need(isObject(sigs), 'sigs must be an object');
      const source = Object.keys(doc.pins).sort()
        .map((path) => ({ path, parsed: safeParse(path) }))
        .filter(({ path, parsed }) => parsed && P.scopeKey(path) === from && copyable(parsed));
      let pins = doc.pins;
      for (const scope of cmd.to) {
        checkScope(scope);
        if (scope === from) continue;
        const cutKey = scope.startsWith('cut/') ? scope.slice(4) : null;
        need(cutKey === null || typeof sigs[cutKey] === 'string', 'sigs needs the text of cut ' + cutKey);
        for (const { parsed } of source) {
          const path = scope + ':' + parsed.slot;
          const target = parsePath(path);
          const v = copyJSON(doc.pins[from + ':' + parsed.slot].v, 'v');
          const pin = makePin(target, v, 'user', cutKey && sigs[cutKey]);
          pins = releaseLockedSlot(doc, setPin(pins, path, pin), target, 'user');
        }
      }
      return put(doc, 'pins', pins);
    }

    // ---- salts, look, locks, filters --------------------------------------------------------------------------------

    function checkSaltKey(key) {
      need(typeof key === 'string', 'key must be a string');
      let ok = true;
      try { P.scopeKey(key); } catch (e) { ok = false; }
      need(ok, 'bad salt key ' + key);
      return key;
    }

    function saltBump(doc, cmd) {
      const key = checkSaltKey(cmd.key);
      return put(doc, 'salts', Object.assign({}, doc.salts, { [key]: (doc.salts[key] || 0) + 1 }));
    }

    function setLook(doc, fields) {
      let look = doc.look;
      for (const k of Object.keys(fields)) look = put(look, k, fields[k]);
      return put(doc, 'look', look);
    }

    function lookOmakase(doc, cmd) {
      need(isUint32(cmd.seed) && isUint32(cmd.moodSeed), 'seed and moodSeed must be 32-bit unsigned integers');
      return setLook(doc, { seed: cmd.seed, moodSeed: cmd.moodSeed });
    }

    function lookSeed(doc, cmd) {
      need(isUint32(cmd.seed), 'seed must be a 32-bit unsigned integer');
      return setLook(doc, { seed: cmd.seed });
    }

    function lookRestore(doc, cmd) {
      need(isUint32(cmd.seed) && isUint32(cmd.moodSeed), 'seed and moodSeed must be 32-bit unsigned integers');
      need(isObject(cmd.salts), 'salts must be an object');
      for (const key of Object.keys(cmd.salts)) {
        checkSaltKey(key);
        need(Number.isInteger(cmd.salts[key]) && cmd.salts[key] >= 1, 'salts must be positive integers');
      }
      const out = setLook(doc, { seed: cmd.seed, moodSeed: cmd.moodSeed });
      return sameJSON(doc.salts, cmd.salts) ? out : put(out, 'salts', Object.assign({}, cmd.salts));
    }

    function lookSet(doc, cmd) {
      const choices = cmd.key === 'aspect' ? D.ASPECTS : cmd.key === 'backdrop' ? D.BACKDROPS : null;
      need(choices !== null, "key must be 'aspect' or 'backdrop'");
      need(choices.includes(cmd.v), cmd.key + ' must be one of ' + choices.join(' '));
      return setLook(doc, { [cmd.key]: cmd.v });
    }

    function lockPinsOf(pins, lineId) {
      return PINS.pinsUnder(pins, 'line/' + lineId).filter((path) => pins[path].by === 'lock');
    }

    // Replaces the line's lock pins with the payload (all by 'lock'); never overwrites a user, AI or tap pin.
    function lockSet(doc, cmd) {
      need(P.isLineId(cmd.lineId), 'lineId must be a line id');
      need(isObject(cmd.pins), 'pins must be an object');
      need(cmd.n === undefined || (Number.isInteger(cmd.n) && cmd.n >= 0), 'n must be an integer ≥ 0');
      const scope = 'line/' + cmd.lineId;
      let pins = without(doc.pins, lockPinsOf(doc.pins, cmd.lineId));
      for (const path of Object.keys(cmd.pins).sort()) {
        const parsed = parsePath(path);
        need(parsed.scope.kind !== 'work' && P.isUnder(path, scope), path + ' is not under ' + scope);
        const given = cmd.pins[path];
        need(isObject(given) && given.by === 'lock', 'lock pins must have by: lock');
        if (pins[path] && pins[path].by !== 'lock') continue;
        pins = setPin(pins, path, makePin(parsed, copyJSON(given.v, 'v'), 'lock', given.sig));
      }
      if (sameJSON(pins, doc.pins)) pins = doc.pins;
      const old = doc.locks[cmd.lineId];
      const n = cmd.n !== undefined ? cmd.n : old ? old.n : 0;
      const locks = old && old.n === n ? doc.locks : Object.assign({}, doc.locks, { [cmd.lineId]: { n } });
      return put(put(doc, 'pins', pins), 'locks', locks);
    }

    function lockClear(doc, cmd) {
      need(P.isLineId(cmd.lineId), 'lineId must be a line id');
      const out = put(doc, 'pins', without(doc.pins, lockPinsOf(doc.pins, cmd.lineId)));
      return put(out, 'locks', without(doc.locks, [cmd.lineId]));
    }

    function keyList(v, what) {
      if (v === null || v === undefined) return null;
      need(Array.isArray(v) && v.every((k) => typeof k === 'string'), what + ' must be a list of keys or null');
      return v.slice();
    }

    function filterSet(doc, cmd) {
      need(D.FILTER_KINDS.includes(cmd.kind), 'kind must be one of ' + D.FILTER_KINDS.join(' '));
      const only = keyList(cmd.only, 'only'), deny = keyList(cmd.deny, 'deny');
      if (only === null && deny === null) return put(doc, 'filters', without(doc.filters, [cmd.kind]));
      const entry = { only, deny };
      if (sameJSON(doc.filters[cmd.kind], entry)) return doc;
      return put(doc, 'filters', Object.assign({}, doc.filters, { [cmd.kind]: entry }));
    }

    // ---- time ---------------------------------------------------------------------------------------------------

    function checkTime(v, what) {
      need(isFiniteNumber(v), what + ' must be a finite number');
      return N.q6(Math.max(0, v));
    }

    function timePin(pins, lineId, slot, v, by) {
      return setPin(pins, 'line/' + lineId + ':' + slot, { v, by });
    }

    // Moves lines by delta from their effective times; the shift stops where the earliest start would go below 0.
    function timeShift(doc, cmd) {
      need(Array.isArray(cmd.lineIds) && cmd.lineIds.length > 0, 'lineIds must be a non-empty list');
      need(isFiniteNumber(cmd.delta), 'delta must be a finite number');
      need(isObject(cmd.base), 'base must be an object');
      for (const id of cmd.lineIds) {
        need(P.isLineId(id), 'bad line id ' + id);
        const b = cmd.base[id];
        need(isObject(b) && isFiniteNumber(b.start) && isFiniteNumber(b.end), 'base needs { start, end } for ' + id);
      }
      const earliest = Math.min(...cmd.lineIds.map((id) => cmd.base[id].start));
      const delta = Math.max(cmd.delta, -earliest);
      let pins = doc.pins;
      for (const id of cmd.lineIds) {
        pins = timePin(pins, id, 'start', checkTime(cmd.base[id].start + delta, 'start'), 'user');
        pins = timePin(pins, id, 'end', checkTime(cmd.base[id].end + delta, 'end'), 'user');
      }
      return put(doc, 'pins', pins);
    }

    function timeTap(doc, cmd) {
      need(Array.isArray(cmd.marks), 'marks must be a list');
      let pins = doc.pins;
      for (const m of cmd.marks) {
        need(isObject(m) && P.isLineId(m.lineId), 'each mark needs a lineId');
        need(m.start !== undefined || m.end !== undefined, 'a mark needs start or end');
        if (m.start !== undefined) pins = timePin(pins, m.lineId, 'start', checkTime(m.start, 'start'), 'tap');
        if (m.end !== undefined) pins = timePin(pins, m.lineId, 'end', checkTime(m.end, 'end'), 'tap');
      }
      return put(doc, 'pins', pins);
    }

    // ---- settings sections: timing, song, output ------------------------------------------------------------------

    const TIMING_KEYS = ['snap', 'lead', 'tail', 'leadIn', 'outro', 'tapLatency'];
    const OUTPUT_KEYS = ['format', 'short', 'fps', 'quality', 'audio', 'range', 'name'];

    // Sets doc[section][key] = v, validated by core/doc (problems under that section refuse the command).
    function setSetting(doc, section, key, v) {
      const cur = doc[section];
      if (sameJSON(cur[key], v) && key in cur) return doc;
      const out = put(doc, section, Object.assign({}, cur, { [key]: copyJSON(v, 'v') }));
      const problems = problemsIn(out, section + '.' + key);
      need(problems.length === 0, problems.join('; '));
      return out;
    }

    function timingSet(doc, cmd) {
      need(TIMING_KEYS.includes(cmd.key), 'key must be one of ' + TIMING_KEYS.join(' '));
      return setSetting(doc, 'timing', cmd.key, cmd.v);
    }

    function outputSet(doc, cmd) {
      need(OUTPUT_KEYS.includes(cmd.key), 'key must be one of ' + OUTPUT_KEYS.join(' '));
      return setSetting(doc, 'output', cmd.key, cmd.v);
    }

    function songSet(doc, cmd) {
      need(isObject(cmd.song), 'song must be an object');
      const song = D.normalize(Object.assign({}, doc, { song: copyJSON(cmd.song, 'song') })).song;
      if (sameJSON(song, doc.song)) return doc;
      const out = put(doc, 'song', song);
      const problems = problemsIn(out, 'song');
      need(problems.length === 0, problems.join('; '));
      return out;
    }

    function songClear(doc) { return put(doc, 'song', null); }

    function songInfo(doc, cmd) {
      need(doc.song !== null, 'there is no song');
      // the same rule as D.validate, so a document the store holds always saves and opens again
      need(cmd.info === null || !D.songInfoProblems(cmd.info).length, 'info must be a song analysis or null');
      if (sameJSON(doc.song.info, cmd.info)) return doc;
      return put(doc, 'song', Object.assign({}, doc.song, { info: copyJSON(cmd.info, 'info') }));
    }

    function batch(doc, cmd) {
      need(Array.isArray(cmd.cmds), 'cmds must be a list');
      return cmd.cmds.reduce(reduce, doc);
    }

    // ---- dispatch -----------------------------------------------------------------------------------------------

    const REDUCERS = new Map([
      ['lyrics.set', lyricsSet], ['lyrics.row', lyricsRow], ['lyrics.move', lyricsMove], ['meta.set', metaSet],
      ['pin.set', pinSet], ['pin.clear', pinClear], ['pin.clearUnder', pinClearUnder], ['pin.promote', pinPromote],
      ['pin.copy', pinCopy], ['salt.bump', saltBump], ['look.omakase', lookOmakase], ['look.seed', lookSeed],
      ['look.restore', lookRestore], ['look.set', lookSet], ['lock.set', lockSet], ['lock.clear', lockClear],
      ['filter.set', filterSet], ['time.shift', timeShift], ['time.tap', timeTap], ['timing.set', timingSet],
      ['song.set', songSet], ['song.clear', songClear], ['song.info', songInfo], ['output.set', outputSet],
      ['batch', batch],
    ]);
    const COMMANDS = Object.freeze([...REDUCERS.keys()]);

    // reduce(doc, cmd) → doc (§3.9). Pure: the same doc when nothing changes; only changed sub-objects are replaced.
    function reduce(doc, cmd) {
      if (!isObject(cmd) || typeof cmd.t !== 'string') throw new CommandError('payload', 'a command needs a string t');
      const fn = REDUCERS.get(cmd.t);
      if (!fn) throw new CommandError('unknown', 'unknown command ' + cmd.t);
      return fn(doc, cmd);
    }

    // { [lineId]: { start, end } } from the Plan's lines (for time.shift payloads); unknown ids are skipped.
    function effectiveTimes(plan, lineIds) {
      const byId = new Map(plan.lines.map((l) => [l.id, l]));
      const out = {};
      for (const id of lineIds) {
        const line = byId.get(id);
        if (line) out[id] = { start: line.t0, end: line.t1 };
      }
      return out;
    }

    return { reduce, effectiveTimes, CommandError, COMMANDS };
  });
