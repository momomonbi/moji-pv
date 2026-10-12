// Copy the pinned, unmodified single-thread FFmpeg core. It is lazy-loaded by an isolated worker, not inlined.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const core = path.dirname(require.resolve('@ffmpeg/core'));
const output = path.resolve(__dirname, '../../vendor/ffmpeg');
const assets = [
  ['ffmpeg-core.js', 112059, 'b266ab5b952555881dd6310663986994a182acb2b7ff25cf10a25f7a37ac2b21'],
  ['ffmpeg-core.wasm', 32232419, '9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7'],
];
fs.mkdirSync(output, { recursive: true });
for (const [name, bytes, hash] of assets) {
  const source = path.join(core, name), content = fs.readFileSync(source);
  if (content.length !== bytes || crypto.createHash('sha256').update(content).digest('hex') !== hash) {
    throw new Error('Unexpected FFmpeg core asset: ' + name + '; review the version, hashes and source notices');
  }
  fs.copyFileSync(source, path.join(output, name));
  process.stdout.write(name + ': ' + bytes + ' bytes, SHA-256 verified\n');
}
