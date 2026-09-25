/* 文字PVメーカー v2 — original work. Test corpus: fixture projects, seed/aspect variants and minimal parts (DESIGN §8.1). */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const stubs = require('../fixtures/stub_parts.js');

const FIXTURES = path.resolve(__dirname, '..', 'fixtures');
const PROJECTS = Object.freeze(['basic', 'vertical', 'lrc', 'long']);
// v2.1 fixtures (schema 2): 'v21' has materials, camera and curve pins, line season and avoid, song sections and a board
// draft; 'media' has four assets (PNG with alpha, JPEG, MP4, WebM with alpha), photoPan and photoFrame pins, a pooled
// asset and output.kit (DESIGN_2_1 §8.1). They are not in PROJECTS, so the v2 goldens keep their keys; ask for them by
// name or pass ALL_PROJECTS.
const V21_PROJECTS = Object.freeze(['v21', 'media']);
const ALL_PROJECTS = Object.freeze(PROJECTS.concat(V21_PROJECTS));
const DEFAULT_ASPECTS = Object.freeze(['16:9', '9:16', '1:1']);

function readFixture(name) { return fs.readFileSync(path.join(FIXTURES, name), 'utf8'); }
function readJSON(name) { return JSON.parse(readFixture(name)); }

// The saved text of a fixture project ('basic' | 'vertical' | 'lrc' | 'long' | 'v21' | 'media').
function projectText(name) {
  if (!ALL_PROJECTS.includes(name)) throw new Error('corpus: unknown project ' + name);
  return readFixture('project_' + name + '.json');
}

// A fresh (unfrozen) { doc, side } of a fixture project, as stored (the v2 fixtures are schema 1).
function project(name) {
  const file = JSON.parse(projectText(name));
  return { doc: file.doc, side: file.side };
}

function projects(names = PROJECTS) { return names.map((name) => Object.assign({ name }, project(name))); }

// A copy of a document with the automatic camerawork switched off by pins (DESIGN_2_1 §2.3, §4.7: a pin wins, at every
// scope): `work:cam.shot` and `work:rig` are 'none'. Every other choice keeps its own stream, so such a document renders
// exactly the v2 frames (tests/golden/frame_hashes_v2.json). `amount.camera = 0` would not: in v2 it already weighs the
// lens choice, the lens amplitudes and the impulses.
function withoutCamerawork(doc) {
  const off = { 'work:cam.shot': { v: 'none', by: 'user' }, 'work:rig': { v: 'none', by: 'user' } };
  return Object.assign({}, doc, { pins: Object.assign({}, doc.pins, off) });
}
function planBasic() { return readJSON('plan_basic.json'); }
function songDigest() { return readJSON('song_digest.json'); }
function sampleLyrics() { return readFixture('sample_lyrics.txt'); }

// A 32-bit seed from labels (FNV-1a; independent of core/hash so the corpus never changes when the kernel does).
function seedOf(...labels) {
  const s = labels.join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// corpus(seeds = 20, aspects = ['16:9', '9:16', '1:1'], names = PROJECTS) → [{ name, doc }]: every fixture project ×
// aspect × seed, with look.seed / moodSeed / aspect changed. Deterministic; every call returns fresh documents.
function corpus(seeds = 20, aspects = DEFAULT_ASPECTS, names = PROJECTS) {
  const out = [];
  for (const name of names) {
    const base = projectText(name);
    for (const aspect of aspects) {
      for (let s = 0; s < seeds; s++) {
        const doc = JSON.parse(base).doc;
        doc.look = Object.assign({}, doc.look, {
          seed: seedOf('seed', name, aspect, s), moodSeed: seedOf('mood', name, aspect, s), aspect,
        });
        out.push({ name: name + '@' + aspect + '#' + s, doc });
      }
    }
  }
  return out;
}

// One fallback definition per part kind plus one theme and one mood, so a single-part registry validates:
// createRegistry([oneDef, ...minimalFallbacks()]).
function minimalFallbacks() { return stubs.fallbackParts(); }
function stubParts() { return stubs.stubParts(); }
function allStubParts() { return stubs.allStubParts(); }

// A registry of every stub part (needs the loaded MV, or the core/registry module itself).
function stubRegistry(MVorRegistry) {
  const REG = MVorRegistry && typeof MVorRegistry.use === 'function' ? MVorRegistry.use('core/registry') : MVorRegistry;
  return REG.createRegistry(stubs.allStubParts());
}

module.exports = {
  FIXTURES, PROJECTS, V21_PROJECTS, ALL_PROJECTS, readFixture, projectText, project, projects, withoutCamerawork, planBasic,
  songDigest, sampleLyrics, seedOf, corpus,
  minimalFallbacks, stubParts, allStubParts, stubRegistry,
};
