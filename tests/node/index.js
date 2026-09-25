/* 文字PVメーカー v2 — original work. Runs every *.test.js here, each in its own process, for `node --test tests/node`. */
'use strict';
// DESIGN §8 runs the Node tests with `node --test tests/node`. Node 22 treats a directory argument as a module, so
// it loads this file. Each test file then runs in a child process of its own (§2.7: module state never leaks between
// files) and is reported here as one test. `node --test "tests/node/*.test.js"` (CI) never loads this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PARALLEL = Math.max(1, Math.min(4, (os.availableParallelism ? os.availableParallelism() : os.cpus().length) - 1));
const SUMMARY = /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm;

function testFiles() {
  return fs.readdirSync(__dirname).filter((name) => name.endsWith('.test.js')).sort();
}

// Runs one test file with the TAP reporter; resolves to { code, output }. The child must not inherit the runner's
// NODE_TEST_CONTEXT, or it would report in the parent's private format instead of TAP.
function runFile(name) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, ['--test-reporter=tap', path.join(__dirname, name)], { env });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (e) => resolve({ code: -1, output: output + String(e && e.stack) }));
    child.on('close', (code, signal) => resolve({ code: signal ? -1 : code, output }));
  });
}

// A queue that runs at most `max` jobs at once; each job is a function returning a promise that never rejects.
function limiter(max) {
  let active = 0;
  const queue = [];
  const pump = () => {
    while (active < max && queue.length) {
      const job = queue.shift();
      active++;
      job().then(() => { active--; pump(); });
    }
  };
  return (fn) => new Promise((resolve) => {
    queue.push(() => fn().then(resolve));
    pump();
  });
}

function summaryOf(output) {
  return [...output.matchAll(SUMMARY)].map((m) => m[1] + ' ' + m[2]).join(', ');
}

const names = testFiles();
const limit = limiter(PARALLEL);
const pending = names.map((name) => limit(() => runFile(name)));   // all files start now; tests below await them
names.forEach((name, i) => {
  test(name, async (t) => {
    const { code, output } = await pending[i];
    t.diagnostic(summaryOf(output) || 'no summary');
    assert.equal(code, 0, name + ' failed:\n' + output);
  });
});
