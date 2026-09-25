/* 文字PVメーカー v2 — original work. Tests for core/sha256 (DESIGN_2_1 §11.3.3, §11.8.2 sha256.test.js). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { load } = require('../helpers/load.js');

const MV = load();
const SHA = MV.use('core/sha256');
const rng = MV.use('core/rng');

const ascii = (s) => Uint8Array.from(Buffer.from(s, 'latin1'));
const digestHex = (bytes) => SHA.hex(SHA.sha256(bytes));

test('sha256: FIPS 180-4 / NIST short and long message vectors', () => {
  assert.equal(digestHex(new Uint8Array(0)), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(digestHex(ascii('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(digestHex(ascii('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  assert.equal(digestHex(ascii('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu')),
    'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1');
  assert.equal(digestHex(new Uint8Array(1000000).fill(0x61)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    'one million times "a"');
  // NIST SHAVS short messages (byte-oriented): one byte 0xbd, and four bytes c98c8e55
  assert.equal(digestHex(Uint8Array.of(0xbd)), '68325720aabd7c82f30f554b313d0570c95accbb7dc4b5aae11204c08ffe732b');
  assert.equal(digestHex(Uint8Array.of(0xc9, 0x8c, 0x8e, 0x55)), '7abc22c0ae5af26ce93dbb94433a0e0b2e119d014f8e7f65bd56c61ccccd9504');
});

test('sha256: every length around the padding boundaries (55, 56, 63, 64, 65 …) matches webcrypto', async () => {
  const s = rng.stream('sha-boundary', 1);
  for (let n = 0; n <= 200; n++) {
    const data = Uint8Array.from({ length: n }, () => s.int(0, 255));
    const want = Buffer.from(await webcrypto.subtle.digest('SHA-256', data)).toString('hex');
    assert.equal(digestHex(data), want, 'length ' + n);
  }
});

test('sha256: 1-byte to 1-MB chunking gives the same digest', () => {
  const s = rng.stream('sha-chunks', 2);
  const data = Uint8Array.from({ length: (1 << 20) + 777 }, () => s.int(0, 255));
  const whole = digestHex(data);
  for (const size of [1, 3, 63, 64, 65, 1000, 4096, 65537, 1 << 20]) {
    const h = SHA.createSha256();
    for (let at = 0; at < data.length; at += size) h.update(data.subarray(at, at + size));
    assert.equal(SHA.hex(h.digest()), whole, 'chunks of ' + size);
  }
  const h = SHA.createSha256();                      // irregular, random chunk sizes including empty ones
  for (let at = 0; at < data.length;) {
    const size = s.int(0, 9000);
    h.update(data.subarray(at, at + size));
    at += size;
  }
  assert.equal(SHA.hex(h.digest()), whole, 'random chunk sizes');
});

test('sha256: equals crypto.subtle on 200 random buffers', async () => {
  const s = rng.stream('sha-random', 3);
  for (let k = 0; k < 200; k++) {
    const n = k < 100 ? s.int(0, 300) : s.int(0, 70000);
    const data = Uint8Array.from({ length: n }, () => s.int(0, 255));
    const want = Buffer.from(await webcrypto.subtle.digest('SHA-256', data)).toString('hex');
    const h = SHA.createSha256();
    const cut = s.int(0, n);
    h.update(data.subarray(0, cut)).update(data.subarray(cut));
    assert.equal(SHA.hex(h.digest()), want, 'buffer ' + k + ' (' + n + ' bytes)');
  }
});

test('sha256: misuse throws; hex is lowercase', () => {
  const h = SHA.createSha256();
  h.digest();
  assert.throws(() => h.update(new Uint8Array(1)), /after digest/);
  assert.throws(() => h.digest(), /twice/);
  assert.throws(() => SHA.createSha256().update([1, 2]), TypeError);
  assert.equal(SHA.hex(Uint8Array.of(0, 15, 16, 255)), '000f10ff');
});
