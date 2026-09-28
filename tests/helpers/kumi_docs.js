/* 文字PVメーカー v2 — original work. Test fixtures: 文字組み documents (DESIGN_2_2 §1, X.3) — the basic project as a new work (look.gen = 1: the automatic settings) and the vertical project with every setting pinned at full strength. */
'use strict';
const corpus = require('./corpus.js');

// The vertical project's second lyric line (r3 is the first): its size contrast is turned off by a line pin.
const VERTICAL_OFF_LINE = 'r4';

function withPins(doc, pins) { return Object.assign({}, doc, { pins: Object.assign({}, doc.pins, pins) }); }

// 'basic' made as a new work: look.gen = 1 and no pin, so every cut takes the new-work defaults (0.7 / 0.5 / 0.5).
function newWork() {
  const doc = corpus.project('basic').doc;
  return Object.assign({}, doc, { look: Object.assign({}, doc.look, { gen: 1 }) });
}

// 'vertical' without the marker, the pin path at full strength: kana, jump and latin 1, 言葉の頭, and one line with
// its size contrast off.
function fullStrength() {
  const user = (v) => ({ v, by: 'user' });
  return withPins(corpus.project('vertical').doc, {
    'work:text.kana': user(1), 'work:text.jump': user(1), 'work:text.head': user('phrase'), 'work:text.latin': user(1),
    ['line/' + VERTICAL_OFF_LINE + ':text.jump']: user(0),
  });
}

// [{ name, doc }] of the golden (tests/golden/project_kumi.json), in a fixed order; fresh documents on every call.
function goldenDocs() {
  return [{ name: 'basic', doc: newWork() }, { name: 'vertical', doc: fullStrength() }];
}

module.exports = { VERTICAL_OFF_LINE, newWork, fullStrength, goldenDocs, withPins };
