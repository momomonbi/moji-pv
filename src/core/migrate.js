/* 文字PVメーカー v2 — original work. Reading project files: JSON, schema upgrades, defaults, validation (DESIGN §3.2, §4.4). */
MV.def('core/migrate', ['core/doc'], (D) => {
  'use strict';

  const CURRENT_SCHEMA = D.CURRENT_SCHEMA;

  // MIGRATIONS[n] turns a schema-n file into a schema-(n+1) file. Schema 1 is the first, so there are none yet.
  const MIGRATIONS = Object.freeze({});

  class MigrateError extends Error {
    constructor(code, message, problems) {
      super(message || code);
      this.name = 'MigrateError';
      this.code = code;                       // 'bad-json' | 'not-a-project' | 'newer' | 'invalid'
      this.problems = problems || [];
    }
  }

  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  // Upgrades a parsed project file to CURRENT_SCHEMA and returns its { doc, side } (not yet normalized).
  function migrate(json) {
    if (!isObject(json) || json.format !== D.FORMAT) throw new MigrateError('not-a-project', 'not a Moji PV project file');
    let schema = json.schema;
    if (!Number.isInteger(schema) || schema < 1) throw new MigrateError('not-a-project', 'missing or bad schema number');
    if (schema > CURRENT_SCHEMA) {
      throw new MigrateError('newer', 'made by a newer version (schema ' + schema + ' > ' + CURRENT_SCHEMA + ')');
    }
    let file = json;
    while (schema < CURRENT_SCHEMA) {
      const step = MIGRATIONS[schema];
      if (!step) throw new MigrateError('invalid', 'no migration from schema ' + schema);
      file = step(file);
      schema += 1;
    }
    if (!isObject(file.doc)) throw new MigrateError('not-a-project', 'the file has no document');
    return { doc: file.doc, side: file.side };
  }

  // Project file text → { doc, side }, ready for the store. Throws MigrateError. The doc is refused when invalid; the
  // side (history only, not undoable) is cleaned instead (D.sanitizeSide), so a damaged history never reaches the UI.
  function parseFile(text) {
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new MigrateError('bad-json', 'the file is not JSON: ' + e.message);
    }
    const { doc, side } = migrate(json);
    const out = { doc: D.normalize(doc), side: D.sanitizeSide(side) };
    const problems = D.validate(out.doc);
    if (problems.length) throw new MigrateError('invalid', 'the project has ' + problems.length + ' problem(s)', problems);
    return out;
  }

  return { CURRENT_SCHEMA, MIGRATIONS, MigrateError, migrate, parseFile };
});
