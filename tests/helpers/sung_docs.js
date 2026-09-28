/* 文字PVメーカー v2 — original work. Test fixtures: 歌ハメ documents (DESIGN_2_2 §6) — the golden tests/golden/project_sung.json, one keyed entry per phase document. */
'use strict';
const corpus = require('./corpus.js');

const pin = (v, by = 'user') => ({ v, by });

// The other packages' switches of a new work, pinned to their older-work values, so the new-work entries (A3, A4)
// show 歌ハメ alone whichever package lands next to it (P2's OTHER_OFF list without P6's own sung.real).
const OTHER_OFF = Object.freeze({ 'work:pv.rules': pin(false), 'work:text.kana': pin(0), 'work:text.jump': pin(0),
  'work:text.latin': pin(0), 'work:morph.auto': pin(false), 'work:weight.auto': pin(false) });

// A2: the lrc fixture's r3 (始発のホームに/白い息) tapped: five characters and the end of the singing.
const A2_TAP = Object.freeze({ 'line/r3:sung.times': pin([[0, 0], [2, 0.45], [5, 0.9], [7, 1.5], [10, 2.4]], 'tap') });
// A4: the repeat fixture's second 飛ばせ/*紙ひこうき*/空の果てまで (rm) tapped; ra, ru and rv copy it.
const A4_TAP = Object.freeze({ 'line/rm:sung.times': pin([[0, 0], [3, 0.52], [8, 1.3], [14, 2.1]], 'tap') });

// The entries: [key, fixture, generation, pins]. A later phase adds its own keys (C1) without touching these.
// D1 (phase D): A2 with 歌った字に色をのせる for the whole video (the karaoke fill on every line, with 歌ハメ).
const ENTRIES = Object.freeze([
  ['A1', 'lrc', 0, { 'work:sung.real': pin(true) }],
  ['A2', 'lrc', 0, Object.assign({ 'work:sung.real': pin(true), 'work:sung.hame': pin(true) }, A2_TAP)],
  ['A3', 'basic', 1, OTHER_OFF],
  ['A4', 'repeat', 1, Object.assign({}, OTHER_OFF, A4_TAP)],
  ['D1', 'lrc', 0, Object.assign({ 'work:sung.real': pin(true), 'work:sung.hame': pin(true), 'work:sung.fill': pin(true) }, A2_TAP)],
]);
const ASPECTS = Object.freeze(['16:9', '9:16']);
const SEEDS = 2;

function withPins(doc, pins) { return Object.assign({}, doc, { pins: Object.assign({}, doc.pins, pins) }); }

// [{ name: '<key> <fixture>@<aspect>#<seed>', doc }] of the golden, in a fixed order; fresh documents on every call.
function goldenDocs(keys) {
  const out = [];
  for (const [key, fixture, gen, pins] of ENTRIES) {
    if (keys && !keys.includes(key)) continue;
    for (const { name, doc } of corpus.corpus(SEEDS, ASPECTS, [fixture])) {
      const d = withPins(doc, pins);
      if (gen) d.look = Object.assign({}, d.look, { gen });
      out.push({ name: key + ' ' + name, doc: d });
    }
  }
  return out;
}

module.exports = { OTHER_OFF, A2_TAP, A4_TAP, ENTRIES, ASPECTS, SEEDS, goldenDocs };
