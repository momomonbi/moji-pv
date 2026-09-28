/* 文字PVメーカー v2 — original work. Test fixtures: キメ documents (DESIGN_2_2 §3) — fixture projects with some lines marked キメ by their line pin, for tests/node/kime.test.js and the golden tests/golden/project_kime.json. */
'use strict';
const corpus = require('./corpus.js');

const ON = Object.freeze({ v: true, by: 'user' });

// The lines the golden marks: the 4th lyric line and a 見せ場 (!) line of each project, so one キメ cut is also 見せ場.
const GOLDEN_LINES = Object.freeze({ basic: Object.freeze(['r7', 'rd']), lrc: Object.freeze(['r6', 'rd']) });

// withKime(doc, lineIds, extra) → a copy of doc with `line/<id>:kime` true on each line (and the extra pins).
function withKime(doc, lineIds, extra) {
  const pins = Object.assign({}, doc.pins);
  for (const id of lineIds) pins['line/' + id + ':kime'] = ON;
  return Object.assign({}, doc, { pins: Object.assign(pins, extra || {}) });
}

// [{ name, doc }] of the golden, in a fixed order; fresh documents on every call: corpus(4, ['16:9', '9:16'],
// ['basic', 'lrc']) with GOLDEN_LINES marked, plus basic@16:9#0 with 「キメの前を静かにする」 off.
function goldenDocs() {
  const out = [];
  for (const { name, doc } of corpus.corpus(4, ['16:9', '9:16'], ['basic', 'lrc'])) {
    out.push({ name, doc: withKime(doc, GOLDEN_LINES[name.split('@')[0]]) });
  }
  const first = corpus.corpus(1, ['16:9'], ['basic'])[0];
  out.push({ name: first.name + '+calmOff',
    doc: withKime(first.doc, GOLDEN_LINES.basic, { 'work:kime.calm': { v: false, by: 'user' } }) });
  return out;
}

module.exports = { ON, GOLDEN_LINES, withKime, goldenDocs };
