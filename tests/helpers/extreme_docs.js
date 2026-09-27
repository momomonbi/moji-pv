/* 文字PVメーカー v2 — original work. Test fixtures: EXTREME camerawork documents (DESIGN_EXTREME §5.2) — the basic project with the switch on and every EXTREME preset on one cut, and a vertical one with the switch on the chorus only. */
'use strict';
const corpus = require('./corpus.js');

// Cut pins of the basic project (its cut keys and texts, the sig a cut pin carries): each of the 12 EXTREME presets on
// one cut, two of them mirrored (r7~0 is on a layout without camerawork: its dutchSwing keeps only the modulators, X7);
// the other cuts take the overlay's automatic picks.
const PRESET_CUTS = Object.freeze([
  ['r4~0', '始発のホームに', 'crashZoom'], ['r4~7', '白い息', 'punchHit'], ['r5~0', '改札の向こうで', 'whipPan'],
  ['r5~7', '朝がほどける', 'whipRead'], ['r6~0', 'ポケットの切符を', 'jumpRead'], ['r6~8', 'そっと握って', 'spinIn~m'],
  ['r7~0', 'まだ名前のない', 'dutchSwing~m'], ['r7~7', '今日へ行く', 'spinOut'], ['ra~3', '紙ひこうき', 'shakeHits'],
  ['ra~8', '空の果てまで', 'beatCrash'], ['rb~0', '折り目の数だけ', 'vertigo'], ['rb~7', '強くなれる', 'orbit'],
]);
const CHORUS = Object.freeze(['ra', 'rb', 'rc', 'rd']);

function withPins(doc, pins) { return Object.assign({}, doc, { pins: Object.assign({}, doc.pins, pins) }); }

// 'basic' at 16:9: work:cam.extreme 1 and the 12 presets pinned on their cuts (by the user, as the shot picker does).
function allPresets() {
  const doc = corpus.project('basic').doc;
  const pins = { 'work:cam.extreme': { v: 1, by: 'user' } };
  for (const [key, sig, v] of PRESET_CUTS) pins['cut/' + key + ':cam.shot'] = { v, by: 'user', sig };
  return withPins(Object.assign({}, doc, { look: Object.assign({}, doc.look, { aspect: '16:9' }) }), pins);
}

// 'basic' at 9:16 with the switch at 0.5 on the chorus lines only (line pins, as an area switch): the overlay's picks.
function chorusOnly() {
  const doc = corpus.project('basic').doc;
  const pins = {};
  for (const id of CHORUS) pins['line/' + id + ':cam.extreme'] = { v: 0.5, by: 'user' };
  return withPins(Object.assign({}, doc, { look: Object.assign({}, doc.look, { aspect: '9:16' }) }), pins);
}

// [{ name, doc }] of the golden (tests/golden/project_extreme.json), in a fixed order; fresh documents on every call.
function goldenDocs() {
  return [{ name: 'basic-all-presets@16:9', doc: allPresets() }, { name: 'basic-chorus-0.5@9:16', doc: chorusOnly() }];
}

module.exports = { PRESET_CUTS, CHORUS, allPresets, chorusOnly, goldenDocs, withPins };
