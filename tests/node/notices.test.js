/* 文字PVメーカー v2 — original work. Tests that the third-party notices agree: THIRD_PARTY_NOTICES.md, the licence texts in vendor/ and the About page's list (ui/dialogs LICENCES, DESIGN §1.4). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, SRC } = require('../helpers/load.js');

const MV = load();
const LICENCES = MV.use('ui/dialogs').LICENCES;
const STRINGS = MV.use('i18n/strings');
const ROOT = path.join(SRC, '..');

// Licence texts are compared word for word; line breaks and spaces may differ (the About page joins wrapped lines).
const norm = (text) => text.replace(/\s+/g, ' ').trim();

// { heading: fenced block } for every fenced block of THIRD_PARTY_NOTICES.md, under its nearest ## or ### heading.
function noticeBlocks() {
  const blocks = new Map();
  let heading = null;
  let inside = null;
  for (const line of fs.readFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8').split('\n')) {
    if (inside) {
      if (line.startsWith('```')) { blocks.set(heading, inside.join('\n')); inside = null; } else inside.push(line);
    } else if (line.startsWith('```')) {
      assert.ok(heading && !blocks.has(heading), 'one licence block per heading: ' + heading);
      inside = [];
    } else {
      const m = /^#{2,3} (.+)$/.exec(line);
      if (m) heading = m[1].trim();
    }
  }
  assert.equal(inside, null, 'every fenced block is closed');
  return blocks;
}

// The notices heading of an About entry: its name, or its name without the trailing version.
function headingOf(blocks, name) {
  if (blocks.has(name)) return name;
  const bare = name.replace(/ \d+(\.\d+)*$/, '');
  return blocks.has(bare) ? bare : null;
}

test('the About page lists every licence of THIRD_PARTY_NOTICES.md, each with the same text', () => {
  const blocks = noticeBlocks();
  const seen = new Set();
  for (const l of LICENCES) {
    const heading = headingOf(blocks, l.name);
    assert.ok(heading, 'THIRD_PARTY_NOTICES.md has a section for ' + l.name);
    seen.add(heading);
    // The About text may add a "MIT License" title before a licence file that has none.
    assert.ok(norm(l.text).endsWith(norm(blocks.get(heading))), l.name + ': the About text is the notice text');
    assert.ok(l.what in STRINGS, l.name + ': label ' + l.what);
  }
  assert.deepEqual([...blocks.keys()].filter((h) => !seen.has(h)), [], 'every notice is on the About page');
});

test('every licence text in vendor/ is one of the notices', () => {
  const texts = [...noticeBlocks().values()].map(norm);
  const files = fs.readdirSync(path.join(ROOT, 'vendor')).filter((f) => /^LICENSE\..+\.txt$/.test(f));
  assert.ok(files.length >= LICENCES.length, 'a licence file per notice (' + files.join(', ') + ')');
  for (const f of files) {
    assert.ok(texts.includes(norm(fs.readFileSync(path.join(ROOT, 'vendor', f), 'utf8'))), 'vendor/' + f + ' is in THIRD_PARTY_NOTICES.md');
  }
});

test('the packages bundled inside vendor/ai-sdk.min.js have their notices', () => {
  // standardwebhooks and the two packages it imports come in with the SDK's webhooks helper (tools/vendor, esbuild).
  const bundle = fs.readFileSync(path.join(ROOT, 'vendor', 'ai-sdk.min.js'), 'utf8');
  const names = LICENCES.map((l) => l.name.replace(/ \d+(\.\d+)*$/, ''));
  const marks = [['standardwebhooks', 'whsec_'], ['@stablelib/base64', 'Base64Coder'], ['fast-sha256', '1116352408']];
  for (const [name, mark] of marks) {
    if (bundle.includes(mark)) assert.ok(names.includes(name), name + ' is in the bundle (' + mark + '), so its notice is listed');
  }
});
