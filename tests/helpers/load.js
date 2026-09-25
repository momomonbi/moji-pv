/* 文字PVメーカー v2 — original work. Node loader: the module kernel plus every src file, as in DESIGN §2.7. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.resolve(__dirname, '..', '..', 'src');
const KERNEL = path.join(SRC, 'core', 'define.js');

// Every .js file under dir, as paths relative to SRC with '/' separators, sorted by code unit.
function listSources(dir = SRC) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSources(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(path.relative(SRC, full).split(path.sep).join('/'));
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// Requires the kernel, sets MV.DEV = true and MV.LANG = 'ja', then requires every other src file (ui/* included;
// factories are lazy). Node's require cache makes repeated calls cheap and keeps each file defined once.
function load() {
  require(KERNEL);
  const MV = globalThis.MV;
  MV.DEV = true;
  MV.LANG = 'ja';
  for (const rel of listSources()) {
    if (rel !== 'core/define.js') require(path.join(SRC, rel));
  }
  return MV;
}

// Shorthand for load().use(id).
function use(id) { return load().use(id); }

module.exports = { load, use, listSources, SRC };
