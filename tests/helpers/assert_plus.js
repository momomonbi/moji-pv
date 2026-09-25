/* 文字PVメーカー v2 — original work. Small assertion helpers for the Node tests. */
'use strict';
const assert = require('node:assert/strict');

// Structural equality after a JSON round trip, so values from another realm (vm contexts, frozen module
// output) compare by content only. Typed arrays should be converted with Array.from first.
function deepEqual(actual, expected, message) {
  assert.deepStrictEqual(roundTrip(actual), roundTrip(expected), message);
}

function roundTrip(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

// |actual − expected| ≤ eps for numbers, element-wise for arrays and typed arrays.
function approx(actual, expected, eps = 1e-9, message) {
  if (typeof expected === 'number') {
    const ok = typeof actual === 'number' && Math.abs(actual - expected) <= eps;
    assert.ok(ok, message || `expected ${actual} ≈ ${expected} (±${eps})`);
    return;
  }
  assert.equal(actual.length, expected.length, message || 'length differs');
  for (let i = 0; i < expected.length; i++) {
    const ok = Math.abs(actual[i] - expected[i]) <= eps;
    assert.ok(ok, message || `at [${i}]: expected ${actual[i]} ≈ ${expected[i]} (±${eps})`);
  }
}

// fn() must throw an error whose `code` equals `code`.
function throwsCode(fn, code, message) {
  assert.throws(fn, (e) => {
    assert.equal(e && e.code, code, message || `expected error code ${code}, got ${e && e.code} (${e && e.message})`);
    return true;
  });
}

module.exports = { deepEqual, approx, throwsCode, roundTrip };
